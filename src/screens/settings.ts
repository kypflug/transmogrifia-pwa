/**
 * Settings Screen for Library of Transmogrifia
 *
 * Card-based form matching the extension's settings UI.
 * Sections: Sync Passphrase, AI Provider, Image Provider, Cloud API, Sync Actions, Danger Zone.
 */

import {
  loadSettings,
  saveSettings,
  clearSettings,
  hasSyncPassphrase,
  setSyncPassphrase,
  clearSyncPassphrase,
  pushSettingsToCloud,
  pullSettingsFromCloud,
} from '../services/settings';
import { showToast } from '../components/toast';
import { escapeHtml } from '../utils/storage';
import type { TransmogrifierSettings, AIProvider, ImageProvider, SharingProvider } from '../types';

export function renderSettings(root: HTMLElement): void {
  root.innerHTML = `
    <div class="settings-layout">
      <header class="settings-header">
        <div class="settings-header-left">
          <span class="settings-header-icon">⚙️</span>
          <h1>Settings</h1>
        </div>
        <div class="settings-header-right">
          <span class="settings-save-indicator hidden" id="settingsSaveIndicator">✓ Saved</span>
          <button class="settings-header-btn" id="settingsBackBtn">← Library</button>
        </div>
      </header>

      <main class="settings-content">

        <!-- Sync Passphrase -->
        <section class="settings-section" id="passphraseSection">
          <div class="settings-section-header">
            <h2>🔐 Sync Passphrase</h2>
            <span class="settings-badge" id="passphraseBadge">Not set</span>
          </div>
          <p class="settings-section-desc">
            Your API keys are encrypted locally on this device automatically.
            To sync settings across devices via OneDrive, set a passphrase here.
            Use the same passphrase on all your devices.
          </p>
          <div class="settings-field">
            <label for="settingsPassphrase">Passphrase</label>
            <div class="settings-input-action">
              <input type="password" id="settingsPassphrase" name="passphrase" placeholder="Enter a strong passphrase…" autocomplete="current-password">
              <button class="settings-input-action-btn" id="togglePassphraseVis" title="Show/hide">👁️</button>
            </div>
          </div>
          <div class="settings-field">
            <label for="settingsPassphraseConfirm">Confirm Passphrase</label>
            <input type="password" id="settingsPassphraseConfirm" name="passphrase-confirm" placeholder="Confirm passphrase…" autocomplete="current-password">
          </div>
          <div class="settings-actions">
            <button class="settings-btn settings-btn-primary" id="setPassphraseBtn">Set Passphrase</button>
            <button class="settings-btn settings-btn-secondary hidden" id="forgetPassphraseBtn">Forget</button>
            <span class="settings-field-error hidden" id="passphraseError"></span>
          </div>
        </section>

        <!-- AI Provider -->
        <section class="settings-section" id="aiSection">
          <div class="settings-section-header">
            <h2>🤖 AI Provider</h2>
            <span class="settings-badge" id="aiBadge">Not configured</span>
          </div>
          <p class="settings-section-desc">
            Configure the AI provider used for transmogrification.
            Your keys are encrypted at rest and never leave your device unencrypted.
          </p>

          <div class="settings-field">
            <label for="settingsAiProvider">Provider</label>
            <select id="settingsAiProvider">
              <option value="azure-openai">Azure OpenAI</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="google">Google Gemini</option>
            </select>
          </div>

          <!-- Azure OpenAI -->
          <div class="settings-provider-fields" id="aiAzureFields">
            <div class="settings-field">
              <label for="aiAzureEndpoint">Endpoint</label>
              <input type="url" id="aiAzureEndpoint" placeholder="https://your-resource.openai.azure.com">
            </div>
            <div class="settings-field">
              <label for="aiAzureKey">API Key</label>
              <input type="password" id="aiAzureKey" placeholder="Azure OpenAI API key" autocomplete="off">
            </div>
            <div class="settings-field">
              <label for="aiAzureDeployment">Deployment</label>
              <input type="text" id="aiAzureDeployment" placeholder="gpt-4o">
            </div>
            <div class="settings-field">
              <label for="aiAzureVersion">API Version</label>
              <input type="text" id="aiAzureVersion" placeholder="2024-10-21">
            </div>
          </div>

          <!-- OpenAI -->
          <div class="settings-provider-fields hidden" id="aiOpenaiFields">
            <div class="settings-field">
              <label for="aiOpenaiKey">API Key</label>
              <input type="password" id="aiOpenaiKey" placeholder="sk-…" autocomplete="off">
            </div>
            <div class="settings-field">
              <label for="aiOpenaiModel">Model</label>
              <input type="text" id="aiOpenaiModel" placeholder="gpt-4o">
            </div>
          </div>

          <!-- Anthropic -->
          <div class="settings-provider-fields hidden" id="aiAnthropicFields">
            <div class="settings-field">
              <label for="aiAnthropicKey">API Key</label>
              <input type="password" id="aiAnthropicKey" placeholder="sk-ant-…" autocomplete="off">
            </div>
            <div class="settings-field">
              <label for="aiAnthropicModel">Model</label>
              <input type="text" id="aiAnthropicModel" placeholder="claude-sonnet-4-20250514">
            </div>
          </div>

          <!-- Google -->
          <div class="settings-provider-fields hidden" id="aiGoogleFields">
            <div class="settings-field">
              <label for="aiGoogleKey">API Key</label>
              <input type="password" id="aiGoogleKey" placeholder="Google API key" autocomplete="off">
            </div>
            <div class="settings-field">
              <label for="aiGoogleModel">Model</label>
              <input type="text" id="aiGoogleModel" placeholder="gemini-2.0-flash">
            </div>
          </div>
        </section>

        <!-- Image Provider -->
        <section class="settings-section" id="imageSection">
          <div class="settings-section-header">
            <h2>🎨 Image Provider</h2>
            <span class="settings-badge" id="imageBadge">None</span>
          </div>
          <p class="settings-section-desc">
            Configure AI image generation for illustrated recipes.
          </p>

          <div class="settings-field">
            <label for="settingsImageProvider">Provider</label>
            <select id="settingsImageProvider">
              <option value="none">None (disabled)</option>
              <option value="azure-openai">Azure OpenAI</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google Gemini</option>
            </select>
          </div>

          <!-- Azure OpenAI Image -->
          <div class="settings-provider-fields hidden" id="imgAzureFields">
            <div class="settings-field">
              <label for="imgAzureEndpoint">Endpoint</label>
              <input type="url" id="imgAzureEndpoint" placeholder="https://your-resource.openai.azure.com">
            </div>
            <div class="settings-field">
              <label for="imgAzureKey">API Key</label>
              <input type="password" id="imgAzureKey" placeholder="Azure OpenAI API key" autocomplete="off">
            </div>
            <div class="settings-field">
              <label for="imgAzureDeployment">Deployment</label>
              <input type="text" id="imgAzureDeployment" placeholder="gpt-image-1">
            </div>
            <div class="settings-field">
              <label for="imgAzureVersion">API Version</label>
              <input type="text" id="imgAzureVersion" placeholder="2024-10-21">
            </div>
          </div>

          <!-- OpenAI Image -->
          <div class="settings-provider-fields hidden" id="imgOpenaiFields">
            <div class="settings-field">
              <label for="imgOpenaiKey">API Key</label>
              <input type="password" id="imgOpenaiKey" placeholder="sk-…" autocomplete="off">
            </div>
            <div class="settings-field">
              <label for="imgOpenaiModel">Model</label>
              <input type="text" id="imgOpenaiModel" placeholder="gpt-image-1">
            </div>
          </div>

          <!-- Google Image -->
          <div class="settings-provider-fields hidden" id="imgGoogleFields">
            <div class="settings-field">
              <label for="imgGoogleKey">API Key</label>
              <input type="password" id="imgGoogleKey" placeholder="Google API key" autocomplete="off">
            </div>
            <div class="settings-field">
              <label for="imgGoogleModel">Model</label>
              <input type="text" id="imgGoogleModel" placeholder="gemini-2.5-flash-image">
            </div>
          </div>
        </section>

        <!-- Article Sharing (BYOS) -->
        <section class="settings-section" id="sharingSection">
          <div class="settings-section-header">
            <h2>🔗 Article Sharing</h2>
            <span class="settings-badge" id="sharingBadge">Disabled</span>
          </div>
          <p class="settings-section-desc">
            Share articles via public links. Bring Your Own Storage (BYOS) — articles are
            uploaded to your Azure Blob Storage account. Short links are generated via the cloud API.
          </p>

          <div class="settings-field">
            <label for="settingsSharingProvider">Storage Provider</label>
            <select id="settingsSharingProvider">
              <option value="none">None (disabled)</option>
              <option value="azure-blob">Azure Blob Storage</option>
            </select>
          </div>

          <!-- Azure Blob fields -->
          <div class="settings-provider-fields hidden" id="sharingAzureBlobFields">
            <div class="settings-field">
              <label for="sharingAccountName">Account Name</label>
              <input type="text" id="sharingAccountName" placeholder="mystorageaccount">
            </div>
            <div class="settings-field">
              <label for="sharingContainerName">Container Name</label>
              <input type="text" id="sharingContainerName" placeholder="shared-articles">
            </div>
            <div class="settings-field">
              <label for="sharingSasToken">SAS Token</label>
              <input type="password" id="sharingSasToken" placeholder="sv=2024-11-04&ss=b&srt=co&sp=rwdl…" autocomplete="off">
            </div>
            <p class="settings-section-desc" style="margin-top: 0.5rem; font-size: 0.8rem;">
              Create a storage account → add a container with <strong>Blob</strong> public access level →
              generate a SAS token (Blob service, Container+Object permissions, Read+Write+Delete, HTTPS only) →
              add a CORS rule for <code>https://transmogrifia.app</code> (GET method).
            </p>
          </div>
        </section>

        <!-- Sync Actions -->
        <section class="settings-section" id="syncSection">
          <div class="settings-section-header">
            <h2>🔄 Settings Sync</h2>
            <span class="settings-badge" id="syncBadge">Local only</span>
          </div>
          <p class="settings-section-desc">
            Sync your encrypted settings to OneDrive so they're available on all your devices.
            Requires setting a sync passphrase above.
          </p>
          <div class="settings-sync-actions">
            <button class="settings-btn settings-btn-secondary" id="pushSettingsBtn" title="Upload settings to OneDrive">
              ⬆️ Push to Cloud
            </button>
            <button class="settings-btn settings-btn-secondary" id="pullSettingsBtn" title="Download settings from OneDrive">
              ⬇️ Pull from Cloud
            </button>
          </div>
          <p class="settings-sync-status" id="syncStatus"></p>
        </section>

        <!-- iOS Share Shortcut (shown only on iOS) -->
        <section class="settings-section hidden" id="iosShortcutSection">
          <div class="settings-section-header">
            <h2>📲 iOS Share Shortcut</h2>
          </div>
          <p class="settings-section-desc">
            iOS doesn't support web-app share targets. You can work around this
            by creating an Apple Shortcut that sends a URL to Transmogrifia from
            the share sheet.
          </p>
          <div class="shortcut-steps">
            <ol>
              <li>Open the <strong>Shortcuts</strong> app on your iPhone or iPad</li>
              <li>Tap <strong>+</strong> to create a new Shortcut</li>
              <li>Name it <strong>Transmogrify</strong></li>
              <li>Add an action: <strong>Receive</strong> input from <strong>Share Sheet</strong> — accept <strong>URLs</strong></li>
              <li>Add an action: <strong>Open URLs</strong></li>
              <li>Tap the URL field and set it to the text below, then insert the <strong>Shortcut Input</strong> variable at the end</li>
            </ol>
          </div>
          <div class="settings-field">
            <label>Share URL template</label>
            <div class="settings-input-action">
              <input type="text" id="iosShortcutUrl" readonly>
              <button class="settings-input-action-btn" id="copyShortcutUrl" title="Copy">📋</button>
            </div>
            <span class="settings-field-hint">Paste this as the URL, then append the Shortcut Input variable</span>
          </div>
          <p class="settings-section-desc" style="margin-top:8px">
            When you share a link and pick <em>Transmogrify</em>, the Shortcut will
            open this app with the URL pre-filled so you can choose a recipe and send it.
          </p>
        </section>

        <!-- Danger Zone -->
        <section class="settings-section settings-danger-section">
          <div class="settings-section-header">
            <h2>⚠️ Danger Zone</h2>
          </div>
          <div class="settings-actions">
            <button class="settings-btn settings-btn-danger" id="clearSettingsBtn">Clear All Settings</button>
          </div>
        </section>

      </main>
    </div>
  `;

  initSettingsScreen().catch(err => {
    console.error('Settings init failed:', err);
    showToast('Failed to load settings', 'error');
  });
}

// ─── Initialization ────────────────

async function initSettingsScreen(): Promise<void> {
  const settings = await loadSettings();

  populateForm(settings);
  updateBadges(settings);
  updatePassphraseUI();

  setupBackButton();
  setupPassphraseSection();
  setupProviderSwitching();
  setupSaveOnChange();
  setupSyncButtons();
  setupClearSettings();
  setupIOSShortcut();
}

// ─── Form population ────────────────

function populateForm(s: TransmogrifierSettings): void {
  // AI provider
  val('settingsAiProvider', s.aiProvider);
  val('aiAzureEndpoint', s.ai.azureOpenai?.endpoint ?? '');
  val('aiAzureKey', s.ai.azureOpenai?.apiKey ?? '');
  val('aiAzureDeployment', s.ai.azureOpenai?.deployment ?? '');
  val('aiAzureVersion', s.ai.azureOpenai?.apiVersion ?? '');
  val('aiOpenaiKey', s.ai.openai?.apiKey ?? '');
  val('aiOpenaiModel', s.ai.openai?.model ?? '');
  val('aiAnthropicKey', s.ai.anthropic?.apiKey ?? '');
  val('aiAnthropicModel', s.ai.anthropic?.model ?? '');
  val('aiGoogleKey', s.ai.google?.apiKey ?? '');
  val('aiGoogleModel', s.ai.google?.model ?? '');

  // Image provider
  val('settingsImageProvider', s.imageProvider);
  val('imgAzureEndpoint', s.image.azureOpenai?.endpoint ?? '');
  val('imgAzureKey', s.image.azureOpenai?.apiKey ?? '');
  val('imgAzureDeployment', s.image.azureOpenai?.deployment ?? '');
  val('imgAzureVersion', s.image.azureOpenai?.apiVersion ?? '');
  val('imgOpenaiKey', s.image.openai?.apiKey ?? '');
  val('imgOpenaiModel', s.image.openai?.model ?? '');
  val('imgGoogleKey', s.image.google?.apiKey ?? '');
  val('imgGoogleModel', s.image.google?.model ?? '');

  // Sharing provider
  val('settingsSharingProvider', s.sharingProvider ?? 'none');
  val('sharingAccountName', s.sharing?.azureBlob?.accountName ?? '');
  val('sharingContainerName', s.sharing?.azureBlob?.containerName ?? '');
  val('sharingSasToken', s.sharing?.azureBlob?.sasToken ?? '');

  // Show correct provider fields
  showProviderFields('ai', s.aiProvider);
  showProviderFields('img', s.imageProvider);
  showSharingFields(s.sharingProvider ?? 'none');
}

function updateBadges(s: TransmogrifierSettings): void {
  // AI badge
  const aiBadge = document.getElementById('aiBadge')!;
  const aiConfigured = hasAIKey(s);
  aiBadge.textContent = aiConfigured ? getProviderName(s.aiProvider) : 'Not configured';
  aiBadge.className = `settings-badge ${aiConfigured ? 'configured' : ''}`;

  // Image badge
  const imageBadge = document.getElementById('imageBadge')!;
  if (s.imageProvider === 'none') {
    imageBadge.textContent = 'None';
    imageBadge.className = 'settings-badge';
  } else {
    const imgConfigured = hasImageKey(s);
    imageBadge.textContent = imgConfigured ? getProviderName(s.imageProvider) : 'Not configured';
    imageBadge.className = `settings-badge ${imgConfigured ? 'configured' : ''}`;
  }

  // Sharing badge
  const sharingBadge = document.getElementById('sharingBadge')!;
  if (s.sharingProvider === 'azure-blob' && s.sharing?.azureBlob?.accountName) {
    sharingBadge.textContent = 'Azure Blob';
    sharingBadge.className = 'settings-badge configured';
  } else {
    sharingBadge.textContent = 'Disabled';
    sharingBadge.className = 'settings-badge';
  }

  // Sync badge
  const syncBadge = document.getElementById('syncBadge')!;
  if (hasSyncPassphrase()) {
    syncBadge.textContent = 'Ready';
    syncBadge.className = 'settings-badge configured';
  } else {
    syncBadge.textContent = 'Local only';
    syncBadge.className = 'settings-badge';
  }
}

function updatePassphraseUI(): void {
  const badge = document.getElementById('passphraseBadge')!;
  const forgetBtn = document.getElementById('forgetPassphraseBtn')!;
  const setBtn = document.getElementById('setPassphraseBtn')!;

  if (hasSyncPassphrase()) {
    badge.textContent = '🔒 Passphrase set';
    badge.className = 'settings-badge configured';
    forgetBtn.classList.remove('hidden');
    setBtn.textContent = 'Change Passphrase';
  } else {
    badge.textContent = '🔓 No passphrase';
    badge.className = 'settings-badge';
    forgetBtn.classList.add('hidden');
    setBtn.textContent = 'Set Passphrase';
  }
}

// ─── Event handlers ────────────────

function setupBackButton(): void {
  document.getElementById('settingsBackBtn')!.addEventListener('click', () => {
    location.hash = '#library';
  });
}

function setupPassphraseSection(): void {
  // Toggle visibility
  document.getElementById('togglePassphraseVis')!.addEventListener('click', () => {
    const input = document.getElementById('settingsPassphrase') as HTMLInputElement;
    const confirm = document.getElementById('settingsPassphraseConfirm') as HTMLInputElement;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    confirm.type = isPassword ? 'text' : 'password';
  });

  // Set passphrase
  document.getElementById('setPassphraseBtn')!.addEventListener('click', () => {
    const input = document.getElementById('settingsPassphrase') as HTMLInputElement;
    const confirm = document.getElementById('settingsPassphraseConfirm') as HTMLInputElement;
    const errorEl = document.getElementById('passphraseError')!;

    const p = input.value.trim();
    const c = confirm.value.trim();

    if (!p) {
      errorEl.textContent = 'Passphrase cannot be empty';
      errorEl.classList.remove('hidden');
      return;
    }
    if (p.length < 8) {
      errorEl.textContent = 'Passphrase must be at least 8 characters';
      errorEl.classList.remove('hidden');
      return;
    }
    if (p !== c) {
      errorEl.textContent = 'Passphrases do not match';
      errorEl.classList.remove('hidden');
      return;
    }

    errorEl.classList.add('hidden');
    setSyncPassphrase(p);
    input.value = '';
    confirm.value = '';
    updatePassphraseUI();
    updateBadges(collectSettings());
    showToast('Passphrase set');
  });

  // Forget passphrase
  document.getElementById('forgetPassphraseBtn')!.addEventListener('click', () => {
    clearSyncPassphrase();
    updatePassphraseUI();
    updateBadges(collectSettings());
    showToast('Passphrase forgotten');
  });
}

function setupProviderSwitching(): void {
  const aiSelect = document.getElementById('settingsAiProvider') as HTMLSelectElement;
  aiSelect.addEventListener('change', () => {
    showProviderFields('ai', aiSelect.value as AIProvider);
  });

  const imgSelect = document.getElementById('settingsImageProvider') as HTMLSelectElement;
  imgSelect.addEventListener('change', () => {
    showProviderFields('img', imgSelect.value as ImageProvider);
  });

  const sharingSelect = document.getElementById('settingsSharingProvider') as HTMLSelectElement;
  sharingSelect.addEventListener('change', () => {
    showSharingFields(sharingSelect.value as SharingProvider);
  });
}

function showSharingFields(provider: SharingProvider): void {
  const fields = document.getElementById('sharingAzureBlobFields');
  if (fields) fields.classList.toggle('hidden', provider !== 'azure-blob');
}

function showProviderFields(prefix: 'ai' | 'img', provider: string): void {
  const providerMap: Record<string, string> = {
    'azure-openai': 'AzureFields',
    'openai': 'OpenaiFields',
    'anthropic': 'AnthropicFields',
    'google': 'GoogleFields',
  };

  for (const [key, suffix] of Object.entries(providerMap)) {
    const el = document.getElementById(`${prefix}${suffix}`);
    if (el) el.classList.toggle('hidden', key !== provider);
  }
}

function setupSaveOnChange(): void {
  // Auto-save on blur for all inputs in settings sections
  const inputs = document.querySelectorAll(
    '#aiSection input, #aiSection select, #imageSection input, #imageSection select, #sharingSection input, #sharingSection select'
  );

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  for (const input of inputs) {
    input.addEventListener('change', () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => doSave(), 300);
    });
    input.addEventListener('blur', () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => doSave(), 300);
    });
  }
}

async function doSave(): Promise<void> {
  const settings = collectSettings();
  await saveSettings(settings);
  updateBadges(settings);
  flashSaveIndicator();
}

function flashSaveIndicator(): void {
  const indicator = document.getElementById('settingsSaveIndicator')!;
  indicator.classList.remove('hidden');
  setTimeout(() => indicator.classList.add('hidden'), 2000);
}

function setupSyncButtons(): void {
  document.getElementById('pushSettingsBtn')!.addEventListener('click', async () => {
    const statusEl = document.getElementById('syncStatus')!;
    try {
      statusEl.textContent = 'Pushing settings…';
      await doSave(); // Ensure latest values are saved
      await pushSettingsToCloud();
      statusEl.textContent = 'Settings pushed to OneDrive ✓';
      showToast('Settings synced to cloud');
    } catch (err) {
      statusEl.textContent = escapeHtml((err as Error).message);
      showToast('Push failed: ' + (err as Error).message, 'error');
    }
  });

  document.getElementById('pullSettingsBtn')!.addEventListener('click', async () => {
    const statusEl = document.getElementById('syncStatus')!;
    try {
      statusEl.textContent = 'Pulling settings…';
      const updated = await pullSettingsFromCloud();
      if (updated) {
        const settings = await loadSettings();
        populateForm(settings);
        updateBadges(settings);
        statusEl.textContent = 'Settings pulled from OneDrive ✓';
        showToast('Settings updated from cloud');
      } else {
        statusEl.textContent = 'Local settings are already up to date';
        showToast('Already up to date');
      }
    } catch (err) {
      statusEl.textContent = escapeHtml((err as Error).message);
      showToast('Pull failed: ' + (err as Error).message, 'error');
    }
  });
}

function setupClearSettings(): void {
  document.getElementById('clearSettingsBtn')!.addEventListener('click', async () => {
    if (!confirm('Clear all settings? This will delete your locally stored API keys and device key. Settings on OneDrive will not be affected.')) {
      return;
    }
    await clearSettings();
    showToast('Settings cleared');
    // Reload settings screen
    const root = document.getElementById('app')!;
    renderSettings(root);
  });
}

function setupIOSShortcut(): void {
  // Only show on iOS / iPadOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) return;

  const section = document.getElementById('iosShortcutSection');
  if (!section) return;
  section.classList.remove('hidden');

  const shareUrl = `${window.location.origin}/?share-target&url=`;
  const urlInput = document.getElementById('iosShortcutUrl') as HTMLInputElement;
  urlInput.value = shareUrl;

  document.getElementById('copyShortcutUrl')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Copied to clipboard');
    } catch {
      // Fallback — select the input
      urlInput.select();
      showToast('Select and copy the URL');
    }
  });
}

// ─── Collect form data into settings ────────────────

function collectSettings(): TransmogrifierSettings {
  const aiProvider = val('settingsAiProvider') as AIProvider;
  const imageProvider = val('settingsImageProvider') as ImageProvider;

  return {
    version: 1,
    aiProvider,
    ai: {
      azureOpenai: {
        endpoint: val('aiAzureEndpoint'),
        apiKey: val('aiAzureKey'),
        deployment: val('aiAzureDeployment'),
        apiVersion: val('aiAzureVersion'),
      },
      openai: {
        apiKey: val('aiOpenaiKey'),
        model: val('aiOpenaiModel'),
      },
      anthropic: {
        apiKey: val('aiAnthropicKey'),
        model: val('aiAnthropicModel'),
      },
      google: {
        apiKey: val('aiGoogleKey'),
        model: val('aiGoogleModel'),
      },
    },
    imageProvider,
    image: {
      azureOpenai: {
        endpoint: val('imgAzureEndpoint'),
        apiKey: val('imgAzureKey'),
        deployment: val('imgAzureDeployment'),
        apiVersion: val('imgAzureVersion'),
      },
      openai: {
        apiKey: val('imgOpenaiKey'),
        model: val('imgOpenaiModel'),
      },
      google: {
        apiKey: val('imgGoogleKey'),
        model: val('imgGoogleModel'),
      },
    },
    cloud: { apiUrl: '' },
    sharingProvider: (val('settingsSharingProvider') || 'none') as SharingProvider,
    sharing: {
      azureBlob: {
        accountName: val('sharingAccountName'),
        containerName: val('sharingContainerName'),
        sasToken: val('sharingSasToken'),
      },
    },
    updatedAt: 0, // Will be set by saveSettings()
  };
}

// ─── Helpers ────────────────

/** Get or set a form input value */
function val(id: string): string;
function val(id: string, value: string): void;
function val(id: string, value?: string): string | void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (!el) return value === undefined ? '' : undefined;
  if (value === undefined) return el.value;
  el.value = value;
}

function hasAIKey(s: TransmogrifierSettings): boolean {
  switch (s.aiProvider) {
    case 'azure-openai': return !!(s.ai.azureOpenai?.apiKey);
    case 'openai': return !!(s.ai.openai?.apiKey);
    case 'anthropic': return !!(s.ai.anthropic?.apiKey);
    case 'google': return !!(s.ai.google?.apiKey);
  }
}

function hasImageKey(s: TransmogrifierSettings): boolean {
  switch (s.imageProvider) {
    case 'azure-openai': return !!(s.image.azureOpenai?.apiKey);
    case 'openai': return !!(s.image.openai?.apiKey);
    case 'google': return !!(s.image.google?.apiKey);
    case 'none': return false;
  }
}

function getProviderName(provider: AIProvider | ImageProvider): string {
  switch (provider) {
    case 'azure-openai': return 'Azure OpenAI';
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic Claude';
    case 'google': return 'Google Gemini';
    case 'none': return 'None';
  }
}
