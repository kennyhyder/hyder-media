/**
 * GBP Extract — Bookmarklet script
 * Loaded on business.google.com by the bookmarklet.
 * Extracts location data from the GBP Manager DOM and sends to our API.
 */
(function() {
    'use strict';

    const API_URL = 'https://hyder.me/api/gbp/locations';
    const CLIENT_KEY = 'dunham';

    // Prevent double-load
    if (window.__gbpExtractLoaded) {
        showToast('GBP Extract already running. Use the toolbar.', 'warning');
        return;
    }
    window.__gbpExtractLoaded = true;

    // ─── Find the GBP Panel ───
    function findScrollablePanel() {
        // Find the main scrollable container inside the edit/info panel
        const allEls = document.querySelectorAll('*');
        const candidates = [];
        for (const el of allEls) {
            const s = getComputedStyle(el);
            const overY = s.overflowY;
            if ((overY === 'auto' || overY === 'scroll') &&
                el.scrollHeight > el.clientHeight + 50 &&
                el.clientHeight > 200 &&
                el.clientWidth > 250) {
                candidates.push(el);
            }
        }
        // Return the deepest (most specific) scrollable panel with substantial content
        candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
        // Prefer the one that looks like the info panel (not the main sidebar)
        for (const c of candidates) {
            const text = c.textContent || '';
            if (text.includes('Business name') || text.includes('Business category') ||
                text.includes('Description') || text.includes('Hours') ||
                text.includes('Phone') || text.includes('Website')) {
                return c;
            }
        }
        return candidates[0] || null;
    }

    function findPanelRoot() {
        // Try to find the outermost panel container (dialog/modal)
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) return dialog;
        // Fall back to the scrollable panel's parent
        const scrollable = findScrollablePanel();
        if (scrollable) return scrollable.parentElement || scrollable;
        return null;
    }

    // ─── Extract Text ───
    function extractPanelText() {
        const panel = findPanelRoot();
        if (!panel) return null;

        // Walk the DOM and extract text organized by visual hierarchy
        const sections = [];
        let currentSection = { heading: '', content: [] };

        function walk(el, depth) {
            if (!el || el.offsetHeight === 0) return;

            const tag = el.tagName;
            const role = el.getAttribute('role');
            const text = el.textContent.trim();

            // Skip tiny or hidden elements
            if (!text) return;

            // Detect section headings (bold text, headings, tab content headers)
            const style = getComputedStyle(el);
            const isBold = parseInt(style.fontWeight) >= 600;
            const isLarge = parseFloat(style.fontSize) >= 16;
            const isHeading = (tag && /^H[1-6]$/.test(tag)) || role === 'heading';

            // If it's a heading-like element, start a new section
            if ((isHeading || (isBold && isLarge)) && el.children.length === 0 && text.length < 100) {
                if (currentSection.heading || currentSection.content.length > 0) {
                    sections.push({ ...currentSection });
                }
                currentSection = { heading: text, content: [] };
                return;
            }

            // If it's a leaf text node, add to current section
            if (el.children.length === 0 && text.length > 0) {
                // Avoid duplicate text from parent elements
                currentSection.content.push(text);
                return;
            }

            // Recurse into children
            for (const child of el.children) {
                walk(child, depth + 1);
            }
        }

        walk(panel, 0);
        if (currentSection.heading || currentSection.content.length > 0) {
            sections.push(currentSection);
        }

        return sections;
    }

    function extractStructuredData() {
        const panel = findPanelRoot();
        if (!panel) return null;

        const fullText = panel.innerText || '';
        const data = {
            raw_text: fullText,
            extracted_at: new Date().toISOString()
        };

        // Try to extract known fields by pattern matching
        const patterns = {
            business_name: /Business name\n(.+)/i,
            categories: /Business category\n([\s\S]*?)(?=\n[A-Z]|\nDescription|\nAbout)/i,
            description: /Description\n([\s\S]*?)(?=\n(?:Business|Opening|Service area|Website|Phone|Address|Hours))/i,
            phone: /(?:Primary phone|Phone number|Phone)\n([^\n]+)/i,
            website: /Website\n([^\n]+)/i,
            address: /(?:Business location|Address)\n([\s\S]*?)(?=\n(?:Service|Hours|Phone|Website|Business name))/i,
        };

        for (const [key, regex] of Object.entries(patterns)) {
            const match = fullText.match(regex);
            if (match) data[key] = match[1].trim();
        }

        // Extract hours if visible
        const hoursMatch = fullText.match(/Hours[\s\S]*?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[\s\S]*?)(?=\n\n|\nSpecial|\nMore|$)/i);
        if (hoursMatch) {
            data.hours_text = hoursMatch[1].trim();
        }

        return data;
    }

    // ─── Fix Scroll ───
    function fixScroll() {
        const panel = findScrollablePanel();
        if (!panel) {
            showToast('Could not find the GBP panel. Make sure a location is open.', 'error');
            return;
        }

        // Remove scroll constraints on the panel and all ancestors up to the dialog
        let el = panel;
        const maxDepth = 10;
        let depth = 0;
        while (el && depth < maxDepth) {
            const s = getComputedStyle(el);
            if (s.overflow !== 'visible' || s.overflowY !== 'visible') {
                el.style.overflow = 'visible';
                el.style.overflowY = 'visible';
                el.style.maxHeight = 'none';
                el.style.height = 'auto';
            }
            if (el.getAttribute('role') === 'dialog') break;
            el = el.parentElement;
            depth++;
        }

        showToast('Scroll removed! The panel content should now be fully visible. Take your screenshot.', 'success');
    }

    function restoreScroll() {
        // Reload the page to restore (simplest approach)
        if (confirm('This will reload the page to restore the original scroll. Continue?')) {
            window.__gbpExtractLoaded = false;
            location.reload();
        }
    }

    // ─── Copy to Clipboard ───
    function copyExtractedText() {
        const data = extractStructuredData();
        if (!data) {
            showToast('Could not find the GBP panel. Open a location first.', 'error');
            return;
        }

        // Format as readable text
        let text = '=== GBP EXTRACT ===\n';
        text += 'Extracted: ' + data.extracted_at + '\n\n';

        if (data.business_name) text += 'BUSINESS NAME: ' + data.business_name + '\n';
        if (data.categories) text += 'CATEGORIES: ' + data.categories + '\n';
        if (data.phone) text += 'PHONE: ' + data.phone + '\n';
        if (data.website) text += 'WEBSITE: ' + data.website + '\n';
        if (data.address) text += 'ADDRESS: ' + data.address + '\n';
        if (data.description) text += '\nDESCRIPTION:\n' + data.description + '\n';
        if (data.hours_text) text += '\nHOURS:\n' + data.hours_text + '\n';

        text += '\n=== FULL TEXT ===\n' + data.raw_text;

        navigator.clipboard.writeText(text).then(() => {
            showToast('Copied to clipboard! Paste into the capture tool.', 'success');
        }).catch(() => {
            // Fallback: show in a textarea
            showTextModal(text);
        });
    }

    // ─── Send to API ───
    async function sendToAPI() {
        const data = extractStructuredData();
        if (!data) {
            showToast('Could not find the GBP panel. Open a location first.', 'error');
            return;
        }

        const locationName = data.business_name || 'Unknown Location';
        showToast('Sending "' + locationName + '" to Hyder Media...', 'info');

        // Build the data structure our API expects
        const payload = {
            client_key: CLIENT_KEY,
            location_name: locationName,
            data: {
                info: {
                    address: data.address || '',
                    phone: data.phone || '',
                    website: data.website || '',
                    categories: data.categories || '',
                    screenshots: []
                },
                description: {
                    text: data.description || '',
                    screenshots: []
                },
                hours: {
                    hours_text: data.hours_text || '',
                    hours: [],
                    screenshots: []
                },
                _raw: {
                    raw_text: data.raw_text,
                    extracted_at: data.extracted_at
                }
            }
        };

        try {
            const resp = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await resp.json();
            if (!resp.ok || json.error) throw new Error(json.error || 'HTTP ' + resp.status);

            showToast('Saved "' + locationName + '" successfully! View at hyder.me/clients/dunham/gbp', 'success');
        } catch (err) {
            showToast('Failed to save: ' + err.message, 'error');
        }
    }

    // ─── Extract All Locations from List View ───
    function extractLocationList() {
        // On the locations list page, try to find all location entries
        const text = document.body.innerText || '';

        // Find location-like items (business cards in the list)
        const items = [];
        // GBP Manager shows locations in a list/grid with name, address, status
        // Try to find elements that look like location cards
        const allElements = document.querySelectorAll('[data-locationid], [data-location-id], [role="listitem"], [role="row"]');

        if (allElements.length > 0) {
            for (const el of allElements) {
                const t = el.textContent.trim();
                if (t.length > 10 && t.length < 500) {
                    items.push(t);
                }
            }
        }

        if (items.length === 0) {
            // Fallback: just grab all text
            navigator.clipboard.writeText('GBP LOCATIONS LIST\n\n' + text).then(() => {
                showToast('Copied full page text to clipboard.', 'success');
            });
            return;
        }

        const formatted = items.map((item, i) => `${i + 1}. ${item}`).join('\n\n');
        navigator.clipboard.writeText(formatted).then(() => {
            showToast(`Found ${items.length} locations. Copied to clipboard.`, 'success');
        });
    }

    // ─── UI: Toolbar ───
    function createToolbar() {
        // Remove existing toolbar
        const existing = document.getElementById('gbp-extract-toolbar');
        if (existing) existing.remove();

        const bar = document.createElement('div');
        bar.id = 'gbp-extract-toolbar';
        bar.innerHTML = `
            <style>
                #gbp-extract-toolbar {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 999999;
                    background: #1e293b;
                    border: 1px solid #475569;
                    border-radius: 12px;
                    padding: 16px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    color: #f1f5f9;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                    width: 280px;
                    font-size: 13px;
                    line-height: 1.4;
                }
                #gbp-extract-toolbar h3 {
                    margin: 0 0 12px;
                    font-size: 14px;
                    color: #3b82f6;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                #gbp-extract-toolbar .close-btn {
                    background: none; border: none; color: #94a3b8;
                    cursor: pointer; font-size: 18px; padding: 0 4px;
                }
                #gbp-extract-toolbar .close-btn:hover { color: #ef4444; }
                .gx-btn {
                    display: block;
                    width: 100%;
                    padding: 10px;
                    margin-bottom: 6px;
                    border-radius: 6px;
                    border: 1px solid #475569;
                    background: #334155;
                    color: #f1f5f9;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    text-align: left;
                    transition: background 0.15s;
                }
                .gx-btn:hover { background: #475569; }
                .gx-btn.primary { background: #2563eb; border-color: #3b82f6; }
                .gx-btn.primary:hover { background: #1d4ed8; }
                .gx-btn small { display: block; font-weight: 400; color: #94a3b8; margin-top: 2px; font-size: 11px; }
                .gx-divider { border: none; border-top: 1px solid #475569; margin: 10px 0; }
            </style>
            <h3>
                GBP Extract
                <button class="close-btn" onclick="document.getElementById('gbp-extract-toolbar').remove(); window.__gbpExtractLoaded=false;">×</button>
            </h3>
            <button class="gx-btn primary" onclick="(${sendToAPI.toString()})()">
                Send to Hyder Media
                <small>Extract data & save to capture tool</small>
            </button>
            <button class="gx-btn" onclick="(${copyExtractedText.toString()})()">
                Copy All Text
                <small>Copy extracted text to clipboard</small>
            </button>
            <hr class="gx-divider">
            <button class="gx-btn" onclick="(${fixScroll.toString()})()">
                Fix Scroll for Screenshot
                <small>Expand panel so you can screenshot it</small>
            </button>
            <button class="gx-btn" onclick="(${restoreScroll.toString()})()">
                Restore Scroll
                <small>Reload page to undo scroll fix</small>
            </button>
        `;
        document.body.appendChild(bar);
    }

    // ─── UI: Toast ───
    function showToast(msg, type) {
        const existing = document.getElementById('gbp-extract-toast');
        if (existing) existing.remove();

        const colors = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
        const toast = document.createElement('div');
        toast.id = 'gbp-extract-toast';
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 9999999;
            background: #1e293b; border: 1px solid ${colors[type] || '#475569'};
            border-radius: 8px; padding: 12px 16px; max-width: 350px;
            font-family: -apple-system, sans-serif; font-size: 13px;
            color: #f1f5f9; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            border-left: 4px solid ${colors[type] || '#475569'};
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }

    // ─── UI: Text Modal (fallback for clipboard) ───
    function showTextModal(text) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999999;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#1e293b;border-radius:12px;padding:20px;width:90%;max-width:600px;max-height:80vh;display:flex;flex-direction:column;">
                <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                    <strong style="color:#3b82f6;">Extracted Text</strong>
                    <button onclick="this.closest('div').parentElement.remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;">×</button>
                </div>
                <textarea style="flex:1;min-height:300px;background:#0f172a;border:1px solid #475569;border-radius:6px;color:#f1f5f9;padding:12px;font-size:12px;font-family:monospace;resize:none;" readonly>${text.replace(/</g, '&lt;')}</textarea>
                <small style="color:#94a3b8;margin-top:8px;">Select all (Ctrl+A) and copy (Ctrl+C)</small>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    // ─── Init ───
    if (!location.hostname.includes('business.google.com')) {
        showToast('This tool only works on business.google.com. Navigate there first.', 'error');
        window.__gbpExtractLoaded = false;
        return;
    }

    createToolbar();
    showToast('GBP Extract ready! Use the toolbar in the bottom-right corner.', 'success');

})();
