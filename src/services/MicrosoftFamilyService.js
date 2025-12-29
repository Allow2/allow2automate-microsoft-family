/**
 * Microsoft Family Safety Service
 *
 * Interfaces with the unofficial Microsoft Family Mobile API
 * Endpoint: https://familymobile.microsoft.com
 *
 * Based on reverse engineering of the Microsoft Family Safety mobile app
 */

'use strict';

class MicrosoftFamilyService {
    constructor(config = {}) {
        this.config = {
            baseUrl: 'https://familymobile.microsoft.com',
            timeout: config.timeout || 30000,
            headless: config.headless !== false,
            cacheDuration: config.cacheDuration || 300000, // 5 minutes default
            ...config
        };

        this.playwright = null;
        this.browser = null;
        this.context = null;
        this.page = null;
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        this.familyId = null;

        // Cache
        this.cache = {
            familyMembers: { data: null, timestamp: null },
            screenTime: new Map() // childId -> { data, timestamp }
        };

        this.initialized = false;
    }

    /**
     * Initialize Playwright browser
     */
    async init() {
        if (this.initialized) return;

        try {
            // Import Playwright (provided by host app via module injection)
            this.playwright = require('playwright');

            // Launch browser
            this.browser = await this.playwright.chromium.launch({
                headless: this.config.headless,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            // Create persistent context for authentication
            this.context = await this.browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1920, height: 1080 }
            });

            this.initialized = true;
            console.log('[MicrosoftFamilyService] Initialized successfully');
        } catch (error) {
            console.error('[MicrosoftFamilyService] Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Authenticate with Microsoft Account using OAuth
     * Opens browser for user to sign in
     */
    async authenticate() {
        await this.init();

        try {
            this.page = await this.context.newPage();

            // Navigate to Microsoft OAuth login
            const authUrl = 'https://login.live.com/oauth20_authorize.srf?' + new URLSearchParams({
                client_id: '00000000402b5328', // Microsoft Family Safety app client ID
                scope: 'service::familymobile.microsoft.com::MBI_SSL',
                response_type: 'token',
                redirect_uri: 'https://login.live.com/oauth20_desktop.srf'
            });

            console.log('[MicrosoftFamilyService] Opening authentication page...');
            await this.page.goto(authUrl, { waitUntil: 'networkidle' });

            // Wait for authentication to complete (redirect to desktop URI with token in hash)
            console.log('[MicrosoftFamilyService] Waiting for user to sign in...');
            await this.page.waitForURL(/oauth20_desktop\.srf/, { timeout: 300000 }); // 5 min timeout

            // Extract access token from URL hash
            const url = this.page.url();
            const hashParams = new URLSearchParams(url.split('#')[1] || '');

            this.accessToken = hashParams.get('access_token');
            this.refreshToken = hashParams.get('refresh_token');
            const expiresIn = parseInt(hashParams.get('expires_in') || '3600');
            this.tokenExpiry = Date.now() + (expiresIn * 1000);

            if (!this.accessToken) {
                throw new Error('Failed to extract access token from authentication response');
            }

            console.log('[MicrosoftFamilyService] Authentication successful');
            console.log('[MicrosoftFamilyService] Token expires in:', expiresIn, 'seconds');

            await this.page.close();
            this.page = null;

            return {
                success: true,
                accessToken: this.accessToken,
                expiresAt: this.tokenExpiry
            };
        } catch (error) {
            console.error('[MicrosoftFamilyService] Authentication failed:', error);
            if (this.page) await this.page.close();
            throw error;
        }
    }

    /**
     * Check if current token is valid
     */
    isAuthenticated() {
        return this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry;
    }

    /**
     * Get family members (children)
     */
    async getFamilyMembers(forceRefresh = false) {
        if (!this.isAuthenticated()) {
            throw new Error('Not authenticated. Call authenticate() first.');
        }

        // Check cache
        if (!forceRefresh && this.cache.familyMembers.data &&
            (Date.now() - this.cache.familyMembers.timestamp) < this.config.cacheDuration) {
            console.log('[MicrosoftFamilyService] Returning cached family members');
            return this.cache.familyMembers.data;
        }

        try {
            // Call Microsoft Family Mobile API
            const response = await this.apiRequest('/getFamilyInfo');

            if (!response || !response.familyId) {
                throw new Error('Invalid family info response');
            }

            this.familyId = response.familyId;

            const members = (response.users || []).map(user => ({
                id: user.userId,
                name: user.firstName + (user.lastName ? ' ' + user.lastName : ''),
                email: user.email,
                isChild: user.isChild,
                age: user.age,
                avatar: user.profilePictureUrl
            }));

            // Filter to only children
            const children = members.filter(m => m.isChild);

            // Cache result
            this.cache.familyMembers = {
                data: children,
                timestamp: Date.now()
            };

            console.log('[MicrosoftFamilyService] Found', children.length, 'children');
            return children;
        } catch (error) {
            console.error('[MicrosoftFamilyService] Failed to get family members:', error);
            throw error;
        }
    }

    /**
     * Get screen time settings for a child
     */
    async getScreenTime(childId, forceRefresh = false) {
        if (!this.isAuthenticated()) {
            throw new Error('Not authenticated. Call authenticate() first.');
        }

        // Check cache
        const cached = this.cache.screenTime.get(childId);
        if (!forceRefresh && cached && (Date.now() - cached.timestamp) < this.config.cacheDuration) {
            console.log('[MicrosoftFamilyService] Returning cached screen time for:', childId);
            return cached.data;
        }

        try {
            // Get screen time settings
            const response = await this.apiRequest('/getScreenTimeSettings', {
                userId: childId,
                familyId: this.familyId
            });

            const screenTime = {
                childId,
                enabled: response.enabled || false,
                dailyLimit: response.dailyLimitMinutes || 0,
                currentUsage: response.todayUsageMinutes || 0,
                remaining: Math.max(0, (response.dailyLimitMinutes || 0) - (response.todayUsageMinutes || 0)),
                schedule: response.schedule || {},
                lastUpdated: Date.now()
            };

            // Cache result
            this.cache.screenTime.set(childId, {
                data: screenTime,
                timestamp: Date.now()
            });

            return screenTime;
        } catch (error) {
            console.error('[MicrosoftFamilyService] Failed to get screen time for', childId, ':', error);
            throw error;
        }
    }

    /**
     * Set screen time limit for a child
     */
    async setScreenTimeLimit(childId, minutes) {
        if (!this.isAuthenticated()) {
            throw new Error('Not authenticated. Call authenticate() first.');
        }

        try {
            console.log('[MicrosoftFamilyService] Setting screen time limit for', childId, 'to', minutes, 'minutes');

            const response = await this.apiRequest('/setScreenTimeLimit', {
                userId: childId,
                familyId: this.familyId,
                dailyLimitMinutes: minutes,
                enabled: minutes > 0
            });

            // Invalidate cache
            this.cache.screenTime.delete(childId);

            console.log('[MicrosoftFamilyService] Screen time limit updated successfully');
            return {
                success: true,
                childId,
                dailyLimit: minutes
            };
        } catch (error) {
            console.error('[MicrosoftFamilyService] Failed to set screen time limit:', error);
            throw error;
        }
    }

    /**
     * Make authenticated API request to Microsoft Family Mobile backend
     */
    async apiRequest(endpoint, data = null) {
        if (!this.isAuthenticated()) {
            throw new Error('Not authenticated');
        }

        const url = this.config.baseUrl + endpoint;
        const headers = {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Microsoft-Family-Safety-App/1.0'
        };

        try {
            const options = {
                method: data ? 'POST' : 'GET',
                headers
            };

            if (data) {
                options.body = JSON.stringify(data);
            }

            const response = await fetch(url, options);

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[MicrosoftFamilyService] API request failed:', error);
            throw error;
        }
    }

    /**
     * Clear all caches
     */
    clearCache() {
        this.cache.familyMembers = { data: null, timestamp: null };
        this.cache.screenTime.clear();
        console.log('[MicrosoftFamilyService] Cache cleared');
    }

    /**
     * Close browser and cleanup
     */
    async close() {
        try {
            if (this.page) await this.page.close();
            if (this.context) await this.context.close();
            if (this.browser) await this.browser.close();

            this.page = null;
            this.context = null;
            this.browser = null;
            this.initialized = false;

            console.log('[MicrosoftFamilyService] Closed successfully');
        } catch (error) {
            console.error('[MicrosoftFamilyService] Error during close:', error);
        }
    }
}

module.exports = MicrosoftFamilyService;
