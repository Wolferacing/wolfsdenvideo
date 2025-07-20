const { SearchTypes, YouTubeURL } = require('./constants.js');
const Util = require('./util.js');
const fetch = require('node-fetch');
class Scraper {
    /**
     * @param {string} [language = 'en'] An IANA Language Subtag, see => http://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
     */
    constructor(language = 'en') {
        this._lang = language;
        this._innertubeContext = null; // Cache for the YouTube Internal API context.
    }

    /**
     * @param {Object} json
     */
    _extractData(json) {
        json = json
            .contents
            .twoColumnSearchResultsRenderer
            .primaryContents;

        let contents = [];

        if (json.sectionListRenderer) {
            contents = json.sectionListRenderer.contents.filter((item) =>
                item?.itemSectionRenderer?.contents.filter(x => x.videoRenderer || x.playlistRenderer || x.channelRenderer)
            ).shift().itemSectionRenderer.contents;
        }

        if (json.richGridRenderer) {
            contents = json.richGridRenderer.contents.filter((item) =>
                item.richItemRenderer && item.richItemRenderer.content
            ).map(item => item.richItemRenderer.content);
        }

        return contents;
    }

    /**
     * @private
     * @param {string} [requestedLang=this._lang]
     * @returns {object} The headers for a standard request to YouTube.
     */
    _getRequestHeaders(requestedLang = this._lang) {
        return {
            'Accept-Language': requestedLang,
            // Using a modern User-Agent is crucial. It makes our request look like it's from a real, up-to-date
            // browser, which significantly reduces the chance of YouTube serving a minimal "bot" page.
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Cookie': 'CONSENT=YES+yt.4000000000.en+FX+789' // Bypass YouTube's consent screen
        };
    }
    /**
     * @private
     * @param {string} search_query
     * @param {string} [requestedLang=null]
     * @returns {Promise<string>} The entire YouTube webpage as a string
     */
    async _fetch(search_query, searchType = 'VIDEO', requestedLang = this._lang) {
        if (requestedLang && typeof requestedLang !== 'string') {
            throw new TypeError('The request language property was not a string while a valid IANA language subtag is expected.');
        }

        const sp = SearchTypes[searchType.toUpperCase()] || SearchTypes['VIDEO'];

        YouTubeURL.search = new URLSearchParams({
            search_query,
            sp
        });

        const response = await fetch(YouTubeURL, {
            headers: this._getRequestHeaders(requestedLang)
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch search results: ${response.statusText}`);
        }
        return response.text();
    }

    /**
     * @private
     * @param {string} webPage The YouTube webpage with search results
     * @returns The search data
     */
    _getSearchData(webPage) {
        const startString = 'var ytInitialData = ';
        const start = webPage.indexOf(startString);
        const end = webPage.indexOf(';</script>', start);

        const data = webPage.substring(start + startString.length, end);

        try {
            return JSON.parse(data);
        } catch (e) {
            throw new Error('Failed to parse YouTube search data. YouTube might have updated their site or no results returned.');
        }
    }

    _parseData(data) {
        const results = {
            channels: [],
            playlists: [],
            streams: [],
            videos: []
        };

        for (const item of data) {
            // Ordered in which they would occur the most frequently to decrease cost of these if else statements
            if (Util.isVideo(item))
                results.videos.push(Util.getVideoData(item));
            else if (Util.isPlaylist(item))
                results.playlists.push(Util.getPlaylistData(item));
            else if (Util.isStream(item))
                results.streams.push(Util.getStreamData(item));
            else if (Util.isChannel(item))
                results.channels.push(Util.getChannelData(item));
        }

        return results;
    }

    /**
     * @param {string} query The string to search for on youtube
     */
    async search(query, options = {}) {
        const webPage = await this._fetch(query, options.searchType, options.language);

        const parsedJson = this._getSearchData(webPage);

        const extracted = this._extractData(parsedJson);
        const parsed = this._parseData(extracted);

        return parsed;
    }

    /**
     * Fetches the YouTube homepage to extract and cache a complete Innertube context.
     * This includes the API key, client version, and visitor data, which are all
     * necessary to make the API request look like it's from a real browser.
     */
    async _getInnertubeContext() {
        if (this._innertubeContext) {
            return this._innertubeContext;
        }
        try {
            const homePage = await fetch('https://www.youtube.com', { headers: this._getRequestHeaders() }).then(res => res.text());
            
            const apiKey = homePage.match(/"INNERTUBE_API_KEY":"(.*?)"/);
            const clientVersion = homePage.match(/"clientVersion":"(.*?)"/);
            const visitorData = homePage.match(/"visitorData":"(.*?)"/);

            if (apiKey && apiKey[1] && clientVersion && clientVersion[1]) {
                this._innertubeContext = {
                    apiKey: apiKey[1],
                    client: {
                        clientName: "WEB",
                        clientVersion: clientVersion[1],
                        visitorData: visitorData ? visitorData[1] : undefined
                    }
                };
                console.log("Successfully fetched and cached YouTube Innertube context.");
                return this._innertubeContext;
            }
            throw new Error("Could not find all required Innertube context fields on YouTube homepage.");
        } catch (err) {
            console.error("Failed to fetch YouTube Innertube context:", err.message);
            throw new Error("Could not obtain YouTube Innertube context. The scraper may be blocked.");
        }
    }

    /**
     * Fetches video details directly from YouTube's internal API.
     * This is more reliable than scraping the HTML page.
     * @param {string} videoId The 11-character video ID.
     * @returns {Promise<object>} The raw video data object from the API.
     */
    async _getVideoDetailsFromApi(videoId) {
        const innertube = await this._getInnertubeContext();
        const apiUrl = `https://www.youtube.com/youtubei/v1/player?key=${innertube.apiKey}`;

        const requestBody = {
            videoId: videoId,
            context: {
                client: innertube.client
            }
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                ...this._getRequestHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`YouTube API request failed: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * @private
     * @param {object} data The parsed video data from _getVideoData
     * @returns A standardized video object
     */
    _parseVideoData(data) {
        if (data && data.playabilityStatus && data.playabilityStatus.status === 'ERROR') {
            const reason = data.playabilityStatus.reason || 'Video is unavailable.';
            throw new Error(reason);
        }

        // The API response should always contain videoDetails if the video is accessible.
        if (!data || !data.videoDetails) {
            // --- Detailed logging for API response ---
            console.error("--- YouTube API Diagnostics: Failed to find videoDetails ---");
            console.error("The API call was successful, but the response object was missing the 'videoDetails' property.");
            console.error("This usually means the request context was not sufficient to get a full response.");
            console.error("Received data object keys:", data ? Object.keys(data) : 'null');
            // Log a small, safe portion of the data for inspection.
            const dataSnippet = data ? JSON.stringify(data, null, 2) : 'null';
            console.error("Data snippet (first 1000 chars):", dataSnippet.substring(0, 1000));
            console.error("--------------------------------------------------------------------------");
            throw new Error('Could not find video details in the page data.'); // This error is user-facing.
        }

        const videoDetails = data.videoDetails;
        const thumbnails = videoDetails.thumbnail.thumbnails;

        return {
            title: videoDetails.title,
            link: `https://www.youtube.com/watch?v=${videoDetails.videoId}`,
            thumbnail: thumbnails[thumbnails.length - 1].url,
            duration: parseInt(videoDetails.lengthSeconds, 10) * 1000,
            id: videoDetails.videoId,
            channel: {
                name: videoDetails.author,
                id: videoDetails.channelId,
            }
        };
    }

    async getVideoByUrl(url) {
        const videoId = Util.getYoutubeId(url);
        if (!videoId) {
            throw new Error("Invalid YouTube URL provided.");
        }
        // Use the new, reliable API method instead of HTML scraping.
        const apiResponse = await this._getVideoDetailsFromApi(videoId);
        const parsed = this._parseVideoData(apiResponse);
        return parsed;
    }

    /**
     * @param {string} [language='en']
     */
    setLang(language = 'en') {
        this._lang = language;
    }
}
module.exports = Scraper;