#!/bin/bash
# Launch the setup wizard on first login if setup hasn't been completed.
# Runs for any user (root on console, bench on SSH).

if [ -t 0 ] && [ ! -f /var/lib/bench/.setup-complete ]; then
    if [ "$(id -u)" = "0" ]; then
        /usr/local/bin/bench-setup
    else
        sudo /usr/local/bin/bench-setup
    fi
fi
