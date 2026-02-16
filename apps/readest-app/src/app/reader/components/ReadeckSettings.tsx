import React, { useState, useEffect, useMemo } from 'react';
import { MdCheckCircle } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { ReadeckClient } from '@/services/sync/ReadeckClient';
import Dialog from '@/components/Dialog';

// ── Visibility controller (same pattern as KOSyncSettings) ──────────

export const setReadeckSettingsWindowVisible = (visible: boolean) => {
  const dialog = document.getElementById('readeck_settings_window');
  if (dialog) {
    const event = new CustomEvent('setReadeckSettingsVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

// ── Main Settings Window ────────────────────────────────────────────

export const ReadeckSettingsWindow: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const [isOpen, setIsOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState(settings.readeck?.serverUrl || '');
  const [apiToken, setApiToken] = useState(settings.readeck?.apiToken || '');
  const [isConnecting, setIsConnecting] = useState(false);

  const readeck = settings.readeck;
  const isConfigured = useMemo(
    () => !!readeck?.apiToken && !!readeck?.serverUrl && readeck?.enabled,
    [readeck?.apiToken, readeck?.serverUrl, readeck?.enabled],
  );

  // ── Visibility handling ──────────────────────────────────────────

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        setServerUrl(settings.readeck?.serverUrl || '');
        setApiToken(settings.readeck?.apiToken || '');
      }
    };
    const el = document.getElementById('readeck_settings_window');
    el?.addEventListener('setReadeckSettingsVisibility', handleCustomEvent as EventListener);
    return () => {
      el?.removeEventListener('setReadeckSettingsVisibility', handleCustomEvent as EventListener);
    };
  }, [settings.readeck?.serverUrl, settings.readeck?.apiToken]);

  // ── Connect / Disconnect ─────────────────────────────────────────

  const handleConnect = async () => {
    if (!apiToken.trim() || !serverUrl.trim()) return;
    setIsConnecting(true);

    const tempClient = new ReadeckClient({
      ...readeck,
      serverUrl: serverUrl.trim(),
      apiToken: apiToken.trim(),
    });
    const valid = await tempClient.validateToken();

    if (valid) {
      const newSettings = {
        ...settings,
        readeck: {
          ...readeck,
          serverUrl: serverUrl.trim(),
          apiToken: apiToken.trim(),
          enabled: true,
        },
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
      eventDispatcher.dispatch('toast', {
        message: _('Connected to Readeck'),
        type: 'info',
      });
    } else {
      eventDispatcher.dispatch('toast', {
        message: _('Failed to connect to Readeck. Check your server URL and API token.'),
        type: 'error',
      });
    }
    setIsConnecting(false);
  };

  const handleDisconnect = async () => {
    const newSettings = {
      ...settings,
      readeck: {
        ...readeck,
        apiToken: '',
        enabled: false,
      },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setApiToken('');
    eventDispatcher.dispatch('toast', { message: _('Disconnected from Readeck'), type: 'info' });
  };

  // ── Toggle auto-archive ──────────────────────────────────────────

  const toggleAutoArchive = async () => {
    const newSettings = {
      ...settings,
      readeck: { ...readeck, autoArchive: !readeck.autoArchive },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  return (
    <Dialog
      id='readeck_settings_window'
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title={_('Readeck Settings')}
      boxClassName='sm:!min-w-[520px] sm:h-auto'
    >
      {isOpen && (
        <div className='mb-4 mt-0 flex flex-col gap-4 p-2 sm:p-4'>
          {isConfigured ? (
            <>
              {/* Connected state */}
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <MdCheckCircle className='text-success' size={20} />
                  <span className='text-base-content/80 text-sm'>
                    {_('Connected to Readeck')}
                  </span>
                </div>
                <button
                  className='btn btn-ghost btn-sm text-error'
                  onClick={handleDisconnect}
                >
                  {_('Disconnect')}
                </button>
              </div>

              <hr className='border-base-200' />

              {/* Sync options */}
              <div className='space-y-3'>
                <h3 className='text-base-content text-sm font-medium'>{_('Sync Options')}</h3>
                <div className='flex h-10 items-center justify-between'>
                  <span className='text-base-content/80 text-sm'>
                    {_('Auto-archive when finished')}
                  </span>
                  <input
                    type='checkbox'
                    className='toggle toggle-sm'
                    checked={readeck.autoArchive}
                    onChange={toggleAutoArchive}
                  />
                </div>
              </div>

              <div className='text-base-content/50 text-center text-xs'>
                {_('Articles are synced every {{minutes}} minutes', {
                  minutes: readeck.syncIntervalMinutes || 30,
                })}
              </div>
            </>
          ) : (
            <>
              {/* Not connected state */}
              <p className='text-base-content/70 text-center text-sm'>
                {_('Connect your Readeck server to import articles and sync reading progress.')}
              </p>

              <div className='form-control w-full'>
                <label className='label py-1'>
                  <span className='label-text font-medium'>{_('Server URL')}</span>
                </label>
                <input
                  type='text'
                  placeholder='https://readeck.example.com'
                  className='input input-bordered h-12 w-full text-sm focus:outline-none focus:ring-0'
                  spellCheck='false'
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                />
              </div>

              <div className='form-control w-full'>
                <label className='label py-1'>
                  <span className='label-text font-medium'>{_('API Token')}</span>
                </label>
                <input
                  type='password'
                  placeholder={_('Paste your Readeck API token')}
                  className='input input-bordered h-12 w-full text-sm focus:outline-none focus:ring-0'
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                />
              </div>

              <button
                className='btn btn-primary mt-2 h-12 min-h-12 w-full'
                onClick={handleConnect}
                disabled={isConnecting || !serverUrl.trim() || !apiToken.trim()}
              >
                {isConnecting ? (
                  <span className='loading loading-spinner' />
                ) : (
                  _('Connect')
                )}
              </button>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
};
