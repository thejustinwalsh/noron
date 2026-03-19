# Build and test benchmark appliance on macOS via OrbStack
#
# Cross-compiles Bun binaries on Mac, builds ISO in an OrbStack VM,
# tests the full setup wizard in a disposable VM.
#
# Usage:
#   make iso               # build full ISO (arm64 by default)
#   make iso ARCH=x64      # build x64 ISO (emulated, slow)
#   make test-vm            # spin up a test VM with binaries + run setup wizard
#   make vm-clean           # destroy build and test VMs
#   make collect-dist       # build all packages and collect into packages/iso/dist/
#   make clean              # remove all dist/ dirs and turbo cache

ARCH ?= arm64

# Derived variables
ifeq ($(ARCH),arm64)
  BUN_TARGET := bun-linux-arm64
  RUNNER_ARCH := arm64
else ifeq ($(ARCH),x64)
  BUN_TARGET := bun-linux-x64
  RUNNER_ARCH := x64
else
  $(error Unsupported ARCH=$(ARCH). Use arm64 or x64)
endif

ROOT_DIR := $(realpath $(dir $(MAKEFILE_LIST))/..)
ISO_DIST := $(ROOT_DIR)/packages/iso/dist
PKG := $(ROOT_DIR)/packages

BUILD_VM := bench-build
TEST_VM := bench-test

# Binary names for deployment
BINARIES := benchd bench-exec bench-web bench-setup bench
HOOKS := job-started job-completed

.PHONY: iso test-vm vm-clean collect-dist clean build-vm-create build-vm-deps

# ─── Top-level targets ────────────────────────────────────────────────────────

iso: collect-dist build-vm-deps
	@echo "=== Building ISO ($(ARCH)) inside $(BUILD_VM) VM ==="
	orbctl run -m $(BUILD_VM) sudo bash /mnt/mac$(ROOT_DIR)/dev/build-iso-vm.sh \
		/mnt/mac$(ISO_DIST) /mnt/mac$(ROOT_DIR)/provisioning/iso $(LB_ARCH) /mnt/mac$(ISO_DIST)
	@echo ""
	@echo "ISO ready: $(ISO_DIST)/benchmark-appliance-$(ARCH).iso"

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
	orbctl run -m $(TEST_VM) sudo chmod +x /usr/local/lib/benchd/hooks/*
	@echo "--- Installing runner assets ---"
	orbctl run -m $(TEST_VM) sudo mkdir -p /opt/runner/envs
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/runner-image/Containerfile /opt/runner/Containerfile
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/runner-image/start.sh /opt/runner/start.sh
	orbctl run -m $(TEST_VM) sudo chmod +x /opt/runner/start.sh
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ISO_DIST)/runner-image/runner-ctl.sh /usr/local/bin/runner-ctl
	orbctl run -m $(TEST_VM) sudo chmod +x /usr/local/bin/runner-ctl
	@echo "--- Building runner Podman image ---"
	orbctl run -m $(TEST_VM) sudo podman build --build-arg RUNNER_ARCH=$(RUNNER_ARCH) -t bench-runner /opt/runner/
	@echo "--- Installing systemd units ---"
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/systemd/benchd.service /etc/systemd/system/
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/systemd/bench-web.service /etc/systemd/system/
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/systemd/benchmark.slice /etc/systemd/system/
	orbctl run -m $(TEST_VM) sudo cp /mnt/mac$(ROOT_DIR)/provisioning/sysctl.d/99-benchmark.conf /etc/sysctl.d/
	orbctl run -m $(TEST_VM) sudo mkdir -p /var/lib/bench
	orbctl run -m $(TEST_VM) sudo systemctl daemon-reload
	@echo "--- Launching setup wizard ---"
	orbctl run -m $(TEST_VM) sudo /usr/local/bin/bench-setup

vm-clean:
	-orbctl delete -f $(BUILD_VM) 2>/dev/null || true
	-orbctl delete -f $(TEST_VM) 2>/dev/null || true
	@echo "VMs cleaned up"

# ─── Build via turbo → @noron/iso collects everything ────────────────────────

collect-dist:
	BUN_TARGET=$(BUN_TARGET) bun run collect-dist

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
