# Build and test benchmark appliance on macOS via OrbStack
#
# Cross-compiles Bun binaries on Mac, builds ISO in an OrbStack VM,
# tests the full setup wizard in a disposable VM.
#
# Usage:
#   make iso               # build full ISO (arm64 by default)
#   make iso ARCH=x64      # build x64 ISO (emulated, slow)
#   make sbc               # build SBC image (rpi4b by default)
#   make emulate-sbc       # build + boot SBC in QEMU
#   make emulate-iso       # build + boot ISO in QEMU
#   make test-vm            # spin up a test VM with binaries + run setup wizard
#   make collect-dist       # build all packages and collect into packages/iso/dist/
#   make clean              # remove all dist/ dirs and turbo cache

# Load .env.local (or .env) — provides BUN_TARGET, NORON_COMPRESS, etc.
ROOT_DIR := $(realpath $(dir $(firstword $(MAKEFILE_LIST)))/..)
-include $(ROOT_DIR)/.env.local
-include $(ROOT_DIR)/.env
export

ARCH ?= arm64

# Derive BUN_TARGET from ARCH if not set via .env
BUN_TARGET ?= $(if $(filter x64,$(ARCH)),bun-linux-x64,bun-linux-arm64)
RUNNER_ARCH := $(if $(filter x64,$(ARCH)),x64,arm64)
LB_ARCH := $(if $(filter x64,$(ARCH)),amd64,arm64)

ROOT_DIR := $(realpath $(dir $(firstword $(MAKEFILE_LIST)))/..)
ISO_DIST := $(ROOT_DIR)/packages/iso/dist
PKG := $(ROOT_DIR)/packages

BUILD_VM := bench-build
TEST_VM := bench-test

# Binary names for deployment
BINARIES := benchd bench-exec bench-web bench-setup bench
HOOKS := job-started job-completed

BOARD ?= rpi4b

.PHONY: iso test-vm vm-clean collect-dist clean build-vm-create build-vm-deps sbc emulate emulate-iso emulate-sbc

# ─── Top-level targets ────────────────────────────────────────────────────────

iso: collect-dist build-vm-deps
	@echo "=== Building ISO ($(ARCH)) inside $(BUILD_VM) VM ==="
	orbctl run -m $(BUILD_VM) sudo bash /mnt/mac$(ROOT_DIR)/dev/build-iso-vm.sh \
		/mnt/mac$(ISO_DIST) /mnt/mac$(ROOT_DIR)/provisioning/iso $(LB_ARCH) /mnt/mac$(ISO_DIST)
	@echo ""
	@echo "ISO ready: $(ISO_DIST)/noron-$(ARCH).iso"

test-vm: collect-dist
	@echo "=== Creating test VM ($(TEST_VM)) ==="
	-orbctl delete -f $(TEST_VM) 2>/dev/null || true
	orbctl create debian:12 $(TEST_VM)
	@echo "--- Installing packages ---"
	orbctl run -m $(TEST_VM) sudo apt-get update
	orbctl run -m $(TEST_VM) sudo apt-get install -y --no-install-recommends \
		podman sqlite3 lm-sensors cpufrequtils util-linux sudo openssh-server
	@echo "--- Copying binaries ---"
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/benchd/benchd /usr/local/bin/benchd
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/bench-exec/bench-exec /usr/local/bin/bench-exec
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/web/bench-web /usr/local/bin/bench-web
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/setup/bench-setup /usr/local/bin/bench-setup
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/cli/bench /usr/local/bin/bench
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/bench-updater.sh /usr/local/bin/bench-updater
	orbctl run -m $(TEST_VM) sudo chmod +x /usr/local/bin/benchd /usr/local/bin/bench-exec \
		/usr/local/bin/bench-web /usr/local/bin/bench-setup /usr/local/bin/bench /usr/local/bin/bench-updater
	@echo "--- Copying dashboard ---"
	orbctl run -m $(TEST_VM) sudo mkdir -p /var/lib/bench/dashboard
	orbctl run -m $(TEST_VM) sudo cp -r /mnt/mac$(ISO_DIST)/dashboard/. /var/lib/bench/dashboard/
	@echo "--- Installing hooks ---"
	orbctl run -m $(TEST_VM) sudo mkdir -p /usr/local/lib/benchd/hooks
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/benchd/hooks/job-started /usr/local/lib/benchd/hooks/job-started
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/benchd/hooks/job-completed /usr/local/lib/benchd/hooks/job-completed
	orbctl run -m $(TEST_VM) sudo chmod +x /usr/local/lib/benchd/hooks/job-started /usr/local/lib/benchd/hooks/job-completed
	@echo "--- Installing runner assets ---"
	orbctl run -m $(TEST_VM) sudo mkdir -p /opt/runner/envs
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/runner-image/Containerfile /opt/runner/Containerfile
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/runner-image/start.sh /opt/runner/start.sh
	orbctl run -m $(TEST_VM) sudo chmod +x /opt/runner/start.sh
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/runner-image/runner-ctl.sh /usr/local/bin/runner-ctl
	orbctl run -m $(TEST_VM) sudo chmod +x /usr/local/bin/runner-ctl
	@echo "--- Building runner Podman image ---"
	orbctl run -m $(TEST_VM) sudo podman build --build-arg RUNNER_ARCH=$(RUNNER_ARCH) -t bench-runner /opt/runner/
	@echo "--- Creating bench user ---"
	orbctl run -m $(TEST_VM) sudo bash -c '\
		if ! id bench 2>/dev/null; then \
			adduser --disabled-password --gecos "Noron Benchmark" bench && \
			usermod -aG sudo bench; \
		fi && \
		echo "bench:noron" | chpasswd'
	@echo "--- Installing sudoers ---"
	orbctl run -m $(TEST_VM) sudo bash -c '\
		mkdir -p /etc/sudoers.d && \
		echo "bench ALL=(root) NOPASSWD: /usr/local/bin/bench-setup" > /etc/sudoers.d/bench-setup && \
		echo "bench ALL=(root) NOPASSWD: /usr/local/bin/bench-updater" >> /etc/sudoers.d/bench-setup && \
		chmod 440 /etc/sudoers.d/bench-setup'
	@echo "--- Setting locale ---"
	orbctl run -m $(TEST_VM) sudo bash -c '\
		apt-get install -y -qq locales && \
		sed -i "s/^# *en_US.UTF-8/en_US.UTF-8/" /etc/locale.gen && \
		locale-gen en_US.UTF-8 && \
		echo "LANG=en_US.UTF-8" > /etc/default/locale'
	@echo "--- Installing profile script ---"
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/profile.d/bench-setup.sh /etc/profile.d/
	@echo "--- Installing systemd units ---"
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/iso/first-boot.service /etc/systemd/system/
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/systemd/benchd.service /etc/systemd/system/
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/systemd/bench-web.service /etc/systemd/system/
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/systemd/benchmark.slice /etc/systemd/system/
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/sysctl.d/99-benchmark.conf /etc/sysctl.d/
	orbctl run -m $(TEST_VM) sudo mkdir -p /var/lib/bench
	orbctl run -m $(TEST_VM) sudo chown bench:bench /var/lib/bench
	orbctl run -m $(TEST_VM) sudo systemctl daemon-reload
	@echo ""
	@echo "=== VM ready. Launch the setup wizard with: ==="
	@echo "  orbctl run -m $(TEST_VM) sudo /usr/local/bin/bench-setup"
	@echo ""
	@echo "Or SSH in:"
	@echo "  orbctl run -m $(TEST_VM) bash"
	@echo ""

sbc: collect-dist
	@echo "=== Building SBC image ($(BOARD), NORON_COMPRESS=$(NORON_COMPRESS)) ==="
	$(ROOT_DIR)/provisioning/sbc/build-sbc-image.sh $(BOARD) $(ISO_DIST) $(ISO_DIST)
	@echo "Image ready: $(ISO_DIST)/noron-$(BOARD).img"

emulate-sbc: sbc
	$(ROOT_DIR)/dev/emulate.sh $(ISO_DIST)/noron-$(BOARD).img

emulate-iso: iso
	$(ROOT_DIR)/dev/emulate.sh $(ISO_DIST)/noron-$(ARCH).iso

emulate-fetch:
	$(ROOT_DIR)/dev/emulate.sh --fetch $(or $(BOARD),rpi4b)

vm-clean:
	-orbctl delete -f $(BUILD_VM) 2>/dev/null || true
	-orbctl delete -f $(TEST_VM) 2>/dev/null || true
	@echo "VMs cleaned up"

# ─── Build via turbo → @noron/iso collects everything ────────────────────────

collect-dist:
	cd $(ROOT_DIR) && bun run collect-dist

# ─── Build VM management ──────────────────────────────────────────────────────

build-vm-create:
	@if ! orbctl list 2>/dev/null | grep -q $(BUILD_VM); then \
		echo "=== Creating build VM ($(BUILD_VM)) ==="; \
		orbctl create debian:12 $(BUILD_VM); \
	else \
		echo "Build VM $(BUILD_VM) already exists"; \
	fi

build-vm-deps: build-vm-create
	@echo "=== Ensuring live-build is installed ==="
	orbctl run -m $(BUILD_VM) sudo apt-get update
	orbctl run -m $(BUILD_VM) sudo apt-get install -y live-build debootstrap

# ─── Clean ────────────────────────────────────────────────────────────────────

clean:
	rm -rf $(PKG)/benchd/dist
	rm -rf $(PKG)/bench-exec/dist
	rm -rf $(PKG)/web/dist
	rm -rf $(PKG)/setup/dist
	rm -rf $(PKG)/cli/dist
	rm -rf $(PKG)/dashboard/dist
	rm -rf $(PKG)/action/dist
	rm -rf $(PKG)/iso/dist
	rm -rf .turbo
