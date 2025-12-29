// Copyright [2025] [Allow2 Pty Ltd]
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

'use strict';

// Import UI component
import TabContent from './Components/TabContent';

// Import Microsoft Family modules
const MicrosoftFamilyService = require('./services/MicrosoftFamilyService');

/**
 * Microsoft Family Plugin Factory
 * @param {Object} context - Allow2Automate plugin context
 */
function plugin(context) {
    let state = null;
    let familyService = null;
    let quotaMonitor = null;

    const msFamily = {};

    /**
     * onLoad - Initialize plugin when Allow2Automate starts
     * @param {Object} loadState - Persisted state from previous session
     */
    msFamily.onLoad = function(loadState) {
        console.log('[MS Family] Plugin loading...', loadState);

        // Restore persisted state
        state = loadState || {
            authenticated: false,
            accessToken: null,
            tokenExpiry: null,
            children: {}, // msChildId -> child data
            childLinks: {}, // msChildId -> allow2ChildId
            quotaState: {}, // allow2ChildId -> quota tracking
            settings: {
                headless: true,
                syncInterval: 600000, // 10 minutes default
                aggressiveSyncThreshold: 30 // Minutes remaining
            },
            lastSync: null
        };

        // Initialize service
        familyService = new MicrosoftFamilyService({
            headless: state.settings.headless
        });

        // Restore authentication if available
        if (state.accessToken && state.tokenExpiry && Date.now() < state.tokenExpiry) {
            familyService.accessToken = state.accessToken;
            familyService.tokenExpiry = state.tokenExpiry;
            state.authenticated = true;
            console.log('[MS Family] Restored authentication from state');
        }

        // Setup IPC handlers
        setupIPCHandlers(context, familyService, state);

        console.log('[MS Family] Plugin loaded');
    };

    /**
     * newState - Handle configuration updates
     * @param {Object} newState - Updated state from UI
     */
    msFamily.newState = function(newState) {
        console.log('[MS Family] Plugin state updated:', newState);

        // Check if child links changed - may need to adjust monitoring
        const oldLinks = state.childLinks || {};
        const newLinks = newState.childLinks || {};

        state = newState;

        // If links changed and monitoring is active, restart monitor
        if (quotaMonitor && JSON.stringify(oldLinks) !== JSON.stringify(newLinks)) {
            console.log('[MS Family] Child links changed, restarting quota monitor');
            stopQuotaMonitor();
            if (state.authenticated) {
                startQuotaMonitor(context);
            }
        }
    };

    /**
     * onSetEnabled - Start/stop monitoring when plugin enabled/disabled
     * @param {boolean} enabled - Plugin enabled state
     */
    msFamily.onSetEnabled = function(enabled) {
        console.log(`[MS Family] Plugin ${enabled ? 'enabled' : 'disabled'}`);

        if (enabled) {
            // Start quota monitoring if authenticated
            if (state.authenticated) {
                startQuotaMonitor(context);

                context.statusUpdate({
                    status: 'connected',
                    message: 'Microsoft Family plugin active',
                    timestamp: Date.now()
                });
            } else {
                context.statusUpdate({
                    status: 'configured',
                    message: 'Microsoft Family plugin enabled but not authenticated',
                    timestamp: Date.now()
                });
            }
        } else {
            // Stop monitoring
            stopQuotaMonitor();

            context.statusUpdate({
                status: 'configured',
                message: 'Microsoft Family plugin inactive',
                timestamp: Date.now()
            });
        }

        // Persist state
        context.configurationUpdate(state);
    };

    /**
     * onUnload - Cleanup when plugin is removed
     * @param {Function} callback - Completion callback
     */
    msFamily.onUnload = function(callback) {
        console.log('[MS Family] Plugin unloading...');

        // Stop monitoring
        stopQuotaMonitor();

        // Close browser sessions
        if (familyService) {
            familyService.close()
                .then(() => {
                    console.log('[MS Family] Plugin unloaded');
                    callback(null);
                })
                .catch(err => {
                    console.error('[MS Family] Error during unload:', err);
                    callback(err);
                });
        } else {
            callback(null);
        }
    };

    /**
     * Start quota monitoring loop
     */
    function startQuotaMonitor(context) {
        if (quotaMonitor) {
            console.log('[MS Family] Quota monitor already running');
            return;
        }

        console.log('[MS Family] Starting quota monitor');

        quotaMonitor = setInterval(async () => {
            try {
                await checkAndEnforceQuotas(context);
            } catch (error) {
                console.error('[MS Family] Error in quota monitor:', error);
            }
        }, state.settings.syncInterval);

        // Run immediately
        checkAndEnforceQuotas(context).catch(err => {
            console.error('[MS Family] Initial quota check failed:', error);
        });
    }

    /**
     * Stop quota monitoring loop
     */
    function stopQuotaMonitor() {
        if (quotaMonitor) {
            clearInterval(quotaMonitor);
            quotaMonitor = null;
            console.log('[MS Family] Quota monitor stopped');
        }
    }

    /**
     * Check Allow2 quotas and enforce in Microsoft Family
     */
    async function checkAndEnforceQuotas(context) {
        if (!state.authenticated || !familyService.isAuthenticated()) {
            console.log('[MS Family] Not authenticated, skipping quota check');
            return;
        }

        console.log('[MS Family] Checking quotas for', Object.keys(state.childLinks).length, 'linked children');

        for (const [msChildId, allow2ChildId] of Object.entries(state.childLinks)) {
            try {
                // Get Allow2 quota for this child
                const quota = await context.allow2.getQuota(allow2ChildId);

                if (!quota) {
                    console.log('[MS Family] No quota data for Allow2 child:', allow2ChildId);
                    continue;
                }

                // Calculate remaining minutes
                const remainingMinutes = quota.allowed && quota.remaining > 0
                    ? Math.floor(quota.remaining / 60)
                    : 0;

                // Determine if we should sync
                const shouldSync = determineSyncStrategy(allow2ChildId, remainingMinutes);

                if (shouldSync) {
                    console.log('[MS Family] Syncing quota for child', msChildId, ':', remainingMinutes, 'minutes');

                    // Update Microsoft Family screen time limit
                    await familyService.setScreenTimeLimit(msChildId, remainingMinutes);

                    // Update quota state
                    state.quotaState[allow2ChildId] = {
                        lastSyncTime: Date.now(),
                        lastSyncMinutes: remainingMinutes,
                        allow2Minutes: remainingMinutes
                    };

                    // Persist state
                    context.configurationUpdate(state);

                    // Send notification if quota is low
                    if (remainingMinutes < 10 && remainingMinutes > 0) {
                        context.notification({
                            title: 'Low Screen Time',
                            message: `${state.children[msChildId]?.name} has ${remainingMinutes} minutes remaining`,
                            type: 'warning'
                        });
                    } else if (remainingMinutes === 0) {
                        context.notification({
                            title: 'Screen Time Exhausted',
                            message: `${state.children[msChildId]?.name} has run out of screen time`,
                            type: 'error'
                        });
                    }
                }

            } catch (error) {
                console.error('[MS Family] Error checking quota for child', msChildId, ':', error);
            }
        }

        state.lastSync = Date.now();
        context.configurationUpdate(state);
    }

    /**
     * Determine sync strategy based on remaining time
     * Returns true if sync should occur
     */
    function determineSyncStrategy(allow2ChildId, newMinutes) {
        const quotaState = state.quotaState[allow2ChildId];
        const oldMinutes = quotaState?.allow2Minutes || newMinutes;
        const lastSync = quotaState?.lastSyncTime || 0;
        const now = Date.now();

        // IMMEDIATE: Quota increased - sync ASAP
        if (newMinutes > oldMinutes) {
            console.log('[MS Family] Quota increased, syncing immediately');
            return true;
        }

        // IMMEDIATE: Quota exhausted - disable access
        if (newMinutes === 0 && oldMinutes > 0) {
            console.log('[MS Family] Quota exhausted, syncing immediately');
            return true;
        }

        // AGGRESSIVE: Below threshold - sync every 10 minutes
        if (newMinutes < state.settings.aggressiveSyncThreshold) {
            const aggressiveInterval = 600000; // 10 minutes
            if ((now - lastSync) >= aggressiveInterval) {
                console.log('[MS Family] Below threshold, aggressive sync');
                return true;
            }
        }

        // NORMAL: Above threshold - sync on schedule
        if ((now - lastSync) >= state.settings.syncInterval) {
            console.log('[MS Family] Normal scheduled sync');
            return true;
        }

        return false;
    }

    /**
     * Setup IPC handlers for renderer communication
     */
    function setupIPCHandlers(context, familyService, state) {

        // Authenticate with Microsoft Account
        context.ipcMain.handle('msFamily.authenticate', async (event) => {
            try {
                console.log('[MS Family IPC] Starting authentication...');

                const result = await familyService.authenticate();

                // Save tokens to state
                state.authenticated = true;
                state.accessToken = result.accessToken;
                state.tokenExpiry = result.expiresAt;
                state.lastSync = Date.now();

                context.configurationUpdate(state);

                return [null, {
                    success: true,
                    expiresAt: result.expiresAt
                }];
            } catch (error) {
                console.error('[MS Family IPC] Authentication failed:', error);
                return [{ message: error.message }];
            }
        });

        // Get children from Microsoft Family
        context.ipcMain.handle('msFamily.getChildren', async (event) => {
            try {
                console.log('[MS Family IPC] Getting children...');

                const children = await familyService.getFamilyMembers();

                // Update state
                state.children = children.reduce((acc, child) => {
                    acc[child.id] = child;
                    return acc;
                }, {});
                context.configurationUpdate(state);

                return [null, { children }];
            } catch (error) {
                console.error('[MS Family IPC] Failed to get children:', error);
                return [{ message: error.message }];
            }
        });

        // Link MS Family child to Allow2 child
        context.ipcMain.handle('msFamily.linkChild', async (event, { msChildId, allow2ChildId }) => {
            try {
                console.log('[MS Family IPC] Linking child:', msChildId, '->', allow2ChildId);

                state.childLinks[msChildId] = allow2ChildId;

                // Initialize quota state for this child
                state.quotaState[allow2ChildId] = {
                    lastSyncTime: 0,
                    lastSyncMinutes: 0,
                    allow2Minutes: 0
                };

                context.configurationUpdate(state);

                return [null, { success: true }];
            } catch (error) {
                console.error('[MS Family IPC] Link child failed:', error);
                return [{ message: error.message }];
            }
        });

        // Unlink MS Family child
        context.ipcMain.handle('msFamily.unlinkChild', async (event, { msChildId }) => {
            try {
                console.log('[MS Family IPC] Unlinking child:', msChildId);

                const allow2ChildId = state.childLinks[msChildId];
                delete state.childLinks[msChildId];

                if (allow2ChildId) {
                    delete state.quotaState[allow2ChildId];
                }

                context.configurationUpdate(state);

                return [null, { success: true }];
            } catch (error) {
                console.error('[MS Family IPC] Unlink child failed:', error);
                return [{ message: error.message }];
            }
        });

        // Get screen time for a child
        context.ipcMain.handle('msFamily.getScreenTime', async (event, { msChildId }) => {
            try {
                console.log('[MS Family IPC] Getting screen time for:', msChildId);

                const screenTime = await familyService.getScreenTime(msChildId);

                return [null, screenTime];
            } catch (error) {
                console.error('[MS Family IPC] Get screen time failed:', error);
                return [{ message: error.message }];
            }
        });

        // Set screen time limit manually
        context.ipcMain.handle('msFamily.setScreenTime', async (event, { msChildId, minutes }) => {
            try {
                console.log('[MS Family IPC] Setting screen time:', msChildId, '->', minutes, 'minutes');

                const result = await familyService.setScreenTimeLimit(msChildId, minutes);

                return [null, result];
            } catch (error) {
                console.error('[MS Family IPC] Set screen time failed:', error);
                return [{ message: error.message }];
            }
        });

        // Get plugin status
        context.ipcMain.handle('msFamily.getStatus', async (event) => {
            try {
                return [null, {
                    authenticated: state.authenticated,
                    children: state.children,
                    childLinks: state.childLinks,
                    quotaState: state.quotaState,
                    lastSync: state.lastSync,
                    tokenExpiry: state.tokenExpiry
                }];
            } catch (error) {
                console.error('[MS Family IPC] Get status failed:', error);
                return [{ message: error.message }];
            }
        });

        // Force sync quotas now
        context.ipcMain.handle('msFamily.syncNow', async (event) => {
            try {
                console.log('[MS Family IPC] Force syncing quotas...');

                await checkAndEnforceQuotas(context);

                return [null, { success: true, syncTime: state.lastSync }];
            } catch (error) {
                console.error('[MS Family IPC] Sync failed:', error);
                return [{ message: error.message }];
            }
        });
    }

    return msFamily;
}

module.exports = {
    plugin,
    TabContent
};
