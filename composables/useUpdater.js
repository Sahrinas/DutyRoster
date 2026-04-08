const { ref } = Vue;

export function useUpdater({ showToast, flushPersistSync }) {
    const appVersion = ref(null);
    const updateStatus = ref(null);
    const manualUpdateCheck = ref(false);

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
            if (['available', 'downloading', 'ready', 'error'].includes(data.status)) {
                manualUpdateCheck.value = false;
            }
        });
    }

    return {
        appVersion,
        updateStatus,
        manualUpdateCheck,
        installUpdate,
        checkForUpdates,
    };
}
