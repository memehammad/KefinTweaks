// KefinTweaks Jellyseerr Requests Integration
// Adds "Your Requests" home screen section showing items requested on Jellyseerr
// Requires: cardBuilder.js, localStorageCache.js, utils.js modules to be loaded before this script

(function() {
    'use strict';

    const LOG = (...args) => console.log('[KefinTweaks JellyseerrRequests]', ...args);
    const WARN = (...args) => console.warn('[KefinTweaks JellyseerrRequests]', ...args);
    const ERR = (...args) => console.error('[KefinTweaks JellyseerrRequests]', ...args);

    LOG('Initializing...');

    // Configuration
    const CONFIG = window.KefinTweaksConfig?.jellyseerrRequests || {
        enabled: true,
        itemLimit: 16,
        sortOrder: 'DateAdded',
        sortOrderDirection: 'Descending',
        cardFormat: 'Poster',
        order: 25,
        name: 'Your Requests',
        cacheTime: 5 * 60 * 1000 // 5 minutes
    };

    // Cache key for Jellyseerr requests
    const CACHE_KEY = 'jellyseerr_user_requests';

    /**
     * Get Jellyseerr configuration from KefinTweaksConfig
     * @returns {Object|null} - Jellyseerr config with url and apiKey, or null if not found
     */
    function getJellyseerrConfig() {
        try {
            // Get config from KefinTweaksConfig
            const config = window.KefinTweaksConfig?.jellyseerrRequests;

            if (config && config.url && config.apiKey) {
                LOG('Found Jellyseerr config in KefinTweaksConfig');
                return {
                    url: config.url,
                    apiKey: config.apiKey
                };
            }

            WARN('No Jellyseerr configuration found in KefinTweaksConfig');
            return null;
        } catch (error) {
            ERR('Error reading Jellyseerr config from KefinTweaksConfig:', error);
            return null;
        }
    }

    /**
     * Get current Jellyfin username
     * @returns {Promise<string|null>} - Current user's username
     */
    async function getCurrentJellyfinUsername() {
        try {
            // Get current user from Jellyfin API helper
            const apiClient = window.ApiClient;
            if (apiClient && apiClient.getCurrentUser) {
                const user = await apiClient.getCurrentUser();
                if (user && user.Name) {
                    LOG('Found username from ApiClient:', user.Name);
                    return user.Name;
                }
            }

            WARN('Could not determine current Jellyfin username');
            return null;
        } catch (error) {
            ERR('Error getting current username:', error);
            return null;
        }
    }

    /**
     * Fetch user's requests from Jellyseerr
     * @returns {Promise<Array>} - Array of request items
     */
    async function fetchJellyseerrRequests() {
        const config = getJellyseerrConfig();
        if (!config) {
            WARN('Cannot fetch requests: No Jellyseerr configuration available');
            return [];
        }

        const username = await getCurrentJellyfinUsername();
        if (!username) {
            WARN('Cannot fetch requests: Could not determine current username');
            return [];
        }

        try {
            // Ensure URL doesn't have trailing slash
            const baseUrl = config.url.replace(/\/$/, '');
            const endpoint = `${baseUrl}/api/v1/request?filter=all&take=100&sort=modified&skip=0`;

            LOG('Fetching requests from:', endpoint);

            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'X-Api-Key': config.apiKey,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Jellyseerr API returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            LOG('Received Jellyseerr response:', data);

            // Filter requests by:
            // 1. Current user's jellyfinUsername in modifiedBy
            // 2. Status is "available" (status === 5)
            const allRequests = data.results || [];
            const userRequests = allRequests.filter(request => {
                const modifiedBy = request.modifiedBy;
                const isUserRequest = modifiedBy && modifiedBy.jellyfinUsername === username;
                const isAvailable = request.media && request.media.status === 5; // 5 = available
                return isUserRequest && isAvailable;
            });

            LOG(`Filtered ${userRequests.length} available requests for user "${username}" from ${allRequests.length} total requests`);

            return userRequests;
        } catch (error) {
            ERR('Error fetching Jellyseerr requests:', error);
            return [];
        }
    }

    /**
     * Convert Jellyseerr request to Jellyfin item format for card rendering
     * @param {Object} request - Jellyseerr request object
     * @returns {Object} - Jellyfin-style item object
     */
    function convertRequestToJellyfinItem(request) {
        const media = request.media;
        const tmdbId = media.tmdbId;
        const mediaType = media.mediaType; // 'movie' or 'tv'

        // Determine type
        const itemType = mediaType === 'movie' ? 'Movie' : 'Series';

        // Create a pseudo-item that looks like a Jellyfin item
        return {
            Id: `jellyseerr-${request.id}`,
            Name: media.title || 'Unknown Title',
            Type: itemType,
            ProductionYear: media.releaseDate ? new Date(media.releaseDate).getFullYear() : null,
            Overview: media.overview || '',
            CommunityRating: media.voteAverage || null,
            OfficialRating: media.contentRating || null,
            ImageTags: {
                Primary: media.posterPath || media.backdropPath || ''
            },
            BackdropImageTags: media.backdropPath ? [media.backdropPath] : [],
            IsJellyseerr: true, // Flag for cardBuilder to handle differently
            JellyseerrData: {
                requestId: request.id,
                status: request.status,
                tmdbId: tmdbId,
                mediaType: mediaType
            },
            ServerId: window.ApiClient?.serverId() || 'jellyseerr'
        };
    }

    /**
     * Get user's Jellyseerr requests with caching
     * @returns {Promise<Array>} - Array of Jellyfin-style item objects
     */
    async function getJellyseerrRequestsData() {
        // Check cache first
        if (window.localStorageCache) {
            const cached = window.localStorageCache.get(CACHE_KEY);
            if (cached) {
                LOG('Using cached Jellyseerr requests');
                return cached;
            }
        }

        // Fetch fresh data
        const requests = await fetchJellyseerrRequests();
        const items = requests.map(convertRequestToJellyfinItem);

        // Cache the results
        if (window.localStorageCache) {
            window.localStorageCache.set(CACHE_KEY, items, CONFIG.cacheTime);
        }

        return items;
    }

    /**
     * Render Jellyseerr Requests section on home screen
     * @param {HTMLElement} container - Container to append the section to
     * @returns {Promise<boolean>} - Success status
     */
    async function renderJellyseerrRequestsSection(container) {
        try {
            if (!CONFIG.enabled) {
                LOG('Jellyseerr Requests section is disabled in config');
                return false;
            }

            // Check if section is already on the page
            const sectionContainer = container.querySelector('[data-custom-section-id="jellyseerr-requests"]');
            if (sectionContainer) {
                LOG('Jellyseerr Requests section already on the page, skipping...');
                return false;
            }

            // Check if Jellyseerr is configured
            const config = getJellyseerrConfig();
            if (!config) {
                LOG('Jellyseerr not configured, skipping requests section');
                return false;
            }

            // Get user requests
            const requestItems = await getJellyseerrRequestsData();

            if (requestItems.length === 0) {
                LOG('No Jellyseerr requests found for current user');
                return false; // Auto-hide empty sections
            }

            LOG(`Rendering ${requestItems.length} Jellyseerr requests`);

            // Get config values
            const itemLimit = CONFIG.itemLimit ?? 16;
            const sortOrder = CONFIG.sortOrder ?? 'DateAdded';
            const sortOrderDirection = CONFIG.sortOrderDirection ?? 'Descending';
            const cardFormat = CONFIG.cardFormat ?? 'Poster';
            const order = CONFIG.order ?? 25;
            const sectionName = CONFIG.name || 'Your Requests';

            // Apply sorting and limit
            let sortedItems = requestItems;
            if (sortOrder === 'Random') {
                sortedItems = [...requestItems].sort(() => Math.random() - 0.5);
            } else {
                // Use cardBuilder sort helper if available
                if (window.cardBuilder && typeof window.cardBuilder.sortItems === 'function') {
                    sortedItems = window.cardBuilder.sortItems(requestItems, sortOrder, sortOrderDirection);
                }
            }
            const limitedItems = sortedItems.slice(0, itemLimit);

            if (limitedItems.length === 0) {
                return false;
            }

            // Check if cardBuilder is available
            if (typeof window.cardBuilder === 'undefined' || !window.cardBuilder.renderCards) {
                WARN("cardBuilder not available, skipping Jellyseerr requests section");
                return false;
            }

            // Render the scrollable container
            const scrollableContainer = window.cardBuilder.renderCards(
                limitedItems,
                sectionName,
                null, // No "View All" link for Jellyseerr items
                false, // No navigation link
                cardFormat,
                sortOrder,
                sortOrderDirection
            );

            // Add data attribute to track rendered sections
            scrollableContainer.setAttribute('data-custom-section-id', 'jellyseerr-requests');
            scrollableContainer.setAttribute('data-custom-section-name', sectionName);
            scrollableContainer.style.order = order;

            // Append to container
            container.appendChild(scrollableContainer);

            LOG('Jellyseerr Requests section rendered successfully');
            return true;

        } catch (err) {
            ERR('Error rendering Jellyseerr requests section:', err);
            return false;
        }
    }

    /**
     * Initialize Jellyseerr Requests integration with home screen
     */
    function initializeJellyseerrRequests() {
        if (!window.KefinTweaksUtils) {
            WARN('KefinTweaksUtils not available, retrying in 1 second');
            setTimeout(initializeJellyseerrRequests, 1000);
            return;
        }

        LOG('Registering home page handler with KefinTweaksUtils');

        // Register handler for home page
        window.KefinTweaksUtils.onViewPage(async (view, element) => {
            LOG('Home page detected, checking for section container');

            // Wait a bit for the home sections container to be ready
            setTimeout(async () => {
                const container = document.querySelector('.libraryPage:not(.hide) .homeSectionsContainer');
                if (container) {
                    LOG('Home sections container found, rendering Jellyseerr requests section');
                    await renderJellyseerrRequestsSection(container);
                } else {
                    WARN('Home sections container not found');
                }
            }, 500);
        }, {
            pages: ['home']
        });

        LOG('Jellyseerr Requests integration initialized successfully');
    }

    // Initialize when the script loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeJellyseerrRequests);
    } else {
        initializeJellyseerrRequests();
    }

    // Expose API for manual refresh
    window.KefinTweaksJellyseerrRequests = {
        refresh: async function() {
            if (window.localStorageCache) {
                window.localStorageCache.remove(CACHE_KEY);
            }
            const container = document.querySelector('.libraryPage:not(.hide) .homeSectionsContainer');
            if (container) {
                // Remove existing section
                const existing = container.querySelector('[data-custom-section-id="jellyseerr-requests"]');
                if (existing) {
                    existing.remove();
                }
                // Re-render
                await renderJellyseerrRequestsSection(container);
            }
        },
        getConfig: getJellyseerrConfig,
        testFetch: fetchJellyseerrRequests
    };

    LOG('Initialized successfully');
})();
