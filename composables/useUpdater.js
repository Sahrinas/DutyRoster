const { ref, watch } = Vue;

export function useUpdater({ showToast, flushPersistSync, autoUpdate }) {
    const appVersion = ref(null);
    const updateStatus = ref(null);
    const manualUpdateCheck = ref(false);

    function dismissUpdateStatus() {
        manualUpdateCheck.value = false;
        updateStatus.value = null;
    }

    function installUpdate() {
        if (!window.electronAPI?.installUpdate) {
            showToast('Installationsfunktion ikke tilg\u00E6ngelig.', 'error');
            return;
        }

        showToast('Genstarter og installerer...', 'info');
        flushPersistSync();
        setTimeout(() => {
            window.electronAPI.installUpdate();
        }, 300);
    }

    function downloadUpdate() {
        if (!window.electronAPI?.downloadUpdate) return;
        window.electronAPI.downloadUpdate();
    }

    function checkForUpdates() {
        if (!window.electronAPI?.checkForUpdates) {
            showToast('Opdateringer kan kun tjekkes i app-tilstand', 'error');
            return;
        }

        manualUpdateCheck.value = true;
        updateStatus.value = { status: 'checking' };
        window.electronAPI.checkForUpdates();
    }

    if (window.electronAPI) {
        window.electronAPI.onAppVersion((v) => {
            appVersion.value = v;
        });

        window.electronAPI.onUpdateStatus((data) => {
            updateStatus.value = data;

            if (data.status === 'up-to-date' && manualUpdateCheck.value) {
                manualUpdateCheck.value = false;
                showToast('Du har den nyeste version', 'success');
            }

            // Show toast when update is ready (always, since user may have dismissed the banner)
            if (data.status === 'ready' && data.version) {
                const msg = data.requiresRestart
                    ? `Version ${data.version} er klar \u2014 genstart for at installere`
                    : `Version ${data.version} installeres ved n\u00E6ste lukning`;
                showToast(msg, 'success');
            }

            // For manual checks: notify when found
            if (data.status === 'available' && data.version && data.manual) {
                showToast(`Version ${data.version} er tilg\u00E6ngelig`, 'info');
            }

            if (['available', 'downloading', 'download-error', 'ready', 'installing', 'error'].includes(data.status)) {
                manualUpdateCheck.value = false;
            }
        });

        // Sync the autoUpdate setting to main process whenever it changes
        if (autoUpdate) {
            watch(autoUpdate, (val) => {
                window.electronAPI.setAutoUpdate(val);
            }, { immediate: true });
        }
    }

    return {
        appVersion,
        updateStatus,
        manualUpdateCheck,
        dismissUpdateStatus,
        downloadUpdate,
        installUpdate,
        checkForUpdates,
    };
}
