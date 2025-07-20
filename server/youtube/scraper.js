const { SearchTypes, YouTubeURL } = require('./constants.js');
const Util = require('./util.js');
const fetch = require('node-fetch');
class Scraper {
    /**
     * @param {string} [language = 'en'] An IANA Language Subtag, see => http://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
     */
    constructor(language = 'en') {
        this._lang = language;
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
            headers: {
                'Accept-Language': requestedLang,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
                'Cookie': 'CONSENT=YES+yt.4000000000.en+FX+789' // Bypass YouTube's consent screen
            }
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
     * @private
     * @param {string} url The direct URL of the YouTube video
     * @param {string} [requestedLang=null]
     * @returns {Promise<string>} The entire YouTube webpage as a string
     */
    async _fetchVideoPage(url, requestedLang = this._lang) {
        const response = await fetch(url, {
            headers: {
                'Accept-Language': requestedLang,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
                'Cookie': 'CONSENT=YES+yt.4000000000.en+FX+789' // Bypass YouTube's consent screen
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch video page: ${response.statusText}`);
        }
        return response.text();
    }

    /**
     * @private
     * @param {string} webPage The YouTube video webpage
     * @returns The video data
     */
    _getVideoData(webPage) {
        try {
            // First, try the most direct method to find the player response.
            if (webPage.includes('var ytInitialPlayerResponse = ')) {
                const data = webPage.split('var ytInitialPlayerResponse = ')[1].split(';</script>')[0];
                return JSON.parse(data);
            }

            // As a fallback, the player response is often embedded as a stringified JSON inside ytInitialData.
            // This makes the scraper more resilient to layout changes from YouTube.
            if (webPage.includes('var ytInitialData = ')) {
                const initialDataRaw = webPage.split('var ytInitialData = ')[1].split(';</script>')[0];
                const initialData = JSON.parse(initialDataRaw);

                const playerResponseRaw = initialData.contents?.twoColumnWatchNextResults?.player?.player?.args?.player_response;
                if (playerResponseRaw) {
                    return JSON.parse(playerResponseRaw);
                }
            }

            // If neither method works, we have to fail.
            throw new Error("Could not find 'ytInitialPlayerResponse' or 'ytInitialData' with player response.");
        } catch (e) {
            // Add detailed logging to diagnose why parsing failed, as requested.
            console.error("--- YouTube Scraper Error: Failed to extract player data ---");
            console.error("This usually means YouTube returned a different page (e.g., consent, captcha, or a new layout).");
            console.error("Original error:", e.message);
            console.error("Page snippet (first 2000 chars):", webPage.substring(0, 2000));
            console.error("--------------------------------------------------------------------------");
            throw new Error('Failed to parse YouTube video data. YouTube might have updated their site or the video is unavailable.');
        }
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

        if (!data || !data.videoDetails) {
            // This can happen for various reasons, like a private video.
            throw new Error('Could not find video details in the page data.');
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
        const webPage = await this._fetchVideoPage(url);
        const parsedJson = this._getVideoData(webPage);
        const parsed = this._parseVideoData(parsedJson);
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