#!/bin/bash
set -euo pipefail

# Boot a Noron SBC image in QEMU for local testing.
#
# Usage:
#   ./dev/emulate.sh <image.img[.xz]>           # boot a local image
#   ./dev/emulate.sh --fetch [board]             # fetch latest from GitHub and boot
#   ./dev/emulate.sh --persist <image>           # changes survive reboot
#
# Examples:
#   ./dev/emulate.sh noron-rpi4b.img
#   ./dev/emulate.sh --fetch rpi4b
#   ./dev/emulate.sh --persist noron-rpi4b.img
#
# Boots via QEMU raspi3b with extracted kernel/dtb from the image.
# For ISO testing, use: bun run dev:test:iso (OrbStack VM)
#
# Requirements: brew install qemu mtools

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="${SCRIPT_DIR}/.images"
REPO="thejustinwalsh/noron"

usage() {
    echo "Usage: $0 <image.img[.xz]>"
    echo "       $0 --fetch <rpi4b|orangepi5-plus>"
    exit 1
}

check_deps() {
    if ! command -v qemu-system-aarch64 &>/dev/null; then
        echo "Error: qemu not found. Install with: brew install qemu"
        exit 1
    fi
}

check_mtools() {
    if ! command -v mcopy &>/dev/null; then
        echo "Error: mtools not found. Install with: brew install mtools"
        exit 1
    fi
}

# Fetch the latest image from GitHub Releases.
# Sets FETCH_RESULT to the path of the downloaded file.
fetch_image() {
    local target="$1"
    local ext

    case "$target" in
        rpi4b|orangepi5-plus) ext="img.xz" ;;
        *) echo "Error: Unknown target '$target'. Use: rpi4b, orangepi5-plus"; exit 1 ;;
    esac

    local filename="noron-${target}.${ext}"
    mkdir -p "$WORK_DIR"

    # Check latest release
    echo "Checking latest release..."
    local latest_tag
    latest_tag=$(gh release view --repo "$REPO" --json tagName -q '.tagName')
    echo "Latest release: ${latest_tag}"

    # Sanitize tag for directory name (e.g. @noron/iso@0.1.1 -> noron-iso-0.1.1)
    local safe_tag
    safe_tag=$(echo "$latest_tag" | sed 's|@||g; s|/|-|g')
    local version_dir="${WORK_DIR}/${safe_tag}"
    FETCH_RESULT="${version_dir}/${filename}"

    if [ -f "$FETCH_RESULT" ]; then
        echo "Up to date — already have ${filename} (${latest_tag})"
    else
        echo ""
        echo "Downloading ${filename} from ${latest_tag}..."
        mkdir -p "$version_dir"
        # --clobber in case of partial downloads from a previous attempt
        gh release download "$latest_tag" --repo "$REPO" --pattern "$filename" --dir "$version_dir" --clobber
        echo "Downloaded to ${FETCH_RESULT}"
    fi

    # Prune old versions
    prune_old_images "$safe_tag"
}

prune_old_images() {
    local keep_dir="$1"
    local old_dirs
    old_dirs=$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d ! -name "$keep_dir" ! -name boot 2>/dev/null || true)

    [ -z "$old_dirs" ] && return

    local old_count
    old_count=$(echo "$old_dirs" | wc -l | tr -d ' ')
    local old_size
    old_size=$(du -csh $old_dirs 2>/dev/null | tail -1 | cut -f1)

    echo ""
    echo "Removing ${old_count} old version(s) (${old_size})..."
    echo "$old_dirs" | xargs rm -rf
    echo "Cleaned up."
}

decompress_if_needed() {
    local file="$1"

    if [[ "$file" == *.xz ]]; then
        local decompressed="${file%.xz}"
        if [ -f "$decompressed" ]; then
            echo "Using cached decompressed image"
        else
            local size
            size=$(du -h "$file" | cut -f1)
            echo "Decompressing $(basename "$file") (${size})..."
            xz -dk "$file"
            echo "Done"
        fi
        DECOMPRESS_RESULT="$decompressed"
    else
        DECOMPRESS_RESULT="$file"
    fi
}

# Extract kernel, dtb, and initrd from an Armbian .img boot partition
extract_boot_files() {
    local img="$1"
    local dest_dir="$2"

    check_mtools
    mkdir -p "$dest_dir"

    # Parse MBR to find boot partition offset (partition 1)
    local boot_offset
    boot_offset=$(python3 -c "
import struct, sys
with open('${img}', 'rb') as f:
    f.seek(446)
    e = f.read(16)
    print(struct.unpack('<I', e[8:12])[0] * 512)
")

    echo "Boot partition at offset: ${boot_offset}"

    # Extract kernel
    if mcopy -n -i "${img}@@${boot_offset}" ::vmlinuz "${dest_dir}/kernel" 2>/dev/null; then
        echo "Extracted kernel: vmlinuz"
    elif mcopy -n -i "${img}@@${boot_offset}" ::Image "${dest_dir}/kernel" 2>/dev/null; then
        echo "Extracted kernel: Image"
    else
        echo "Error: Could not find kernel on boot partition"
        mdir -i "${img}@@${boot_offset}" :: 2>/dev/null || true
        exit 1
    fi

    # Extract DTB — use the Pi 3 B+ DTB for QEMU raspi3b machine.
    # The bcm2711 DTB doesn't work because QEMU's raspi4b has broken SD
    # numbering. The bcm2710-rpi-3-b-plus DTB wires the SD controller
    # correctly so /dev/mmcblk0 appears and root mounts successfully.
    if mcopy -n -i "${img}@@${boot_offset}" ::bcm2710-rpi-3-b-plus.dtb "${dest_dir}/board.dtb" 2>/dev/null; then
        echo "Extracted dtb: bcm2710-rpi-3-b-plus.dtb (for QEMU raspi3b)"
    else
        echo "Error: Could not find bcm2710-rpi-3-b-plus.dtb on boot partition"
        exit 1
    fi

    # Extract initrd
    if mcopy -n -i "${img}@@${boot_offset}" ::initrd.img "${dest_dir}/initrd.img" 2>/dev/null; then
        echo "Extracted initrd: initrd.img"
    elif mcopy -n -i "${img}@@${boot_offset}" ::uInitrd "${dest_dir}/uInitrd" 2>/dev/null; then
        dd if="${dest_dir}/uInitrd" of="${dest_dir}/initrd.img" bs=64 skip=1 2>/dev/null
        rm "${dest_dir}/uInitrd"
        echo "Extracted initrd: uInitrd (stripped U-Boot header)"
    else
        echo "Warning: No initrd found, booting without"
    fi
}

boot_sbc_image() {
    local img="$1"
    local boot_dir="${WORK_DIR}/boot"

    check_mtools

    # Extract kernel/dtb from the image
    rm -rf "$boot_dir"
    extract_boot_files "$img" "$boot_dir"

    # Boot using raspi3b machine with the Pi 3 B+ DTB. This is the proven
    # approach from the QEMU community: raspi4b has broken SD numbering,
    # but raspi3b + bcm2710-rpi-3-b-plus.dtb wires mmcblk0 correctly.
    # The arm64 kernel runs fine on the raspi3b machine with cortex-a72 cpu.

    local qemu_args=(
        qemu-system-aarch64
        -machine raspi3b
        -cpu cortex-a72
        -smp 4
        -m 1G
        -kernel "${boot_dir}/kernel"
        -dtb "${boot_dir}/board.dtb"
        -drive "format=raw,file=${img}$([ "$PERSIST" = false ] && echo ',snapshot=on')"
        $([ "$PERSIST" = false ] && echo '-no-reboot')
    )

    # Add initrd if extracted
    if [ -f "${boot_dir}/initrd.img" ]; then
        qemu_args+=(-initrd "${boot_dir}/initrd.img")
    fi

    # Kernel command line — based on the working recipe from QEMU issue tracker.
    # console=tty1 sends output to the QEMU window, console=ttyAMA1 mirrors to terminal.
    # Linux uses the LAST console= as the primary (where init/login runs).
    if [ "$HEADLESS" = true ]; then
        qemu_args+=(
            -append "earlyprintk loglevel=8 console=ttyAMA1,115200 rootdelay=1 root=/dev/mmcblk0p2 rootfstype=ext4 rw dwc_otg.lpm_enable=0 dwc_otg.fiq_fsm_enable=0"
        )
    else
        qemu_args+=(
            -append "earlyprintk loglevel=8 console=ttyAMA1,115200 console=tty1 rootdelay=1 root=/dev/mmcblk0p2 rootfstype=ext4 rw dwc_otg.lpm_enable=0 dwc_otg.fiq_fsm_enable=0"
        )
    fi

    # Networking via USB (raspi3b has no PCI bus)
    qemu_args+=(
        -netdev "user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::9216-:9216"
        -device "usb-net,netdev=net0"
    )

    # Display
    if [ "$HEADLESS" = true ]; then
        qemu_args+=(-nographic)
    else
        qemu_args+=(-display cocoa -device usb-kbd)
    fi

    echo ""
    echo "=== Booting SBC image in QEMU (raspi3b) ==="
    echo "  Image:   ${img}"
    echo "  DTB:     bcm2710-rpi-3-b-plus.dtb"
    echo "  Kernel:  extracted from image boot partition"
    echo ""
    echo "  SSH:     ssh -p 2222 root@localhost (after boot)"
    echo "  Setup:   runs automatically on first login"
    if [ "$PERSIST" = true ]; then
        echo "  Mode:    persistent (changes saved, reboot works)"
    else
        echo "  Mode:    snapshot (changes discarded on exit)"
    fi
    echo "  Quit:    close the window"
    echo ""

    "${qemu_args[@]}"
}

# --- Main ---

check_deps
mkdir -p "$WORK_DIR"

HEADLESS=false
PERSIST=false
FETCH_TARGET=""
IMAGE=""

[ $# -lt 1 ] && usage

# Parse flags
while [ $# -gt 0 ]; do
    case "$1" in
        --headless) HEADLESS=true; shift ;;
        --persist)  PERSIST=true; shift ;;
        --fetch)    shift; [ $# -lt 1 ] && usage; FETCH_TARGET="$1"; shift ;;
        -*)         echo "Unknown flag: $1"; usage ;;
        *)          IMAGE="$1"; shift ;;
    esac
done

# Handle fetch flow — all output goes to terminal, no command substitution
if [ -n "$FETCH_TARGET" ]; then
    fetch_image "$FETCH_TARGET"
    IMAGE="$FETCH_RESULT"
fi

if [ -z "$IMAGE" ]; then
    usage
fi

if [ ! -f "$IMAGE" ]; then
    echo "Error: File not found: $IMAGE"
    exit 1
fi

# Decompress if needed
decompress_if_needed "$IMAGE"
IMAGE="$DECOMPRESS_RESULT"

boot_sbc_image "$IMAGE"
