// popup.js (deterministic selectors for consumer and creator)

const captureBtn = document.getElementById('captureBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const lastCaptureDiv = document.getElementById('lastCapture');

function showLastCaptureUI(obj) {
  if (!obj) {
    lastCaptureDiv.innerHTML = '<em>No captures yet</em>';
    return;
  }
  const html = `
    <div><strong>Ticket:</strong> ${obj.ticketId || '—'}</div>
    <div><strong>Consumer:</strong> ${obj.consumerName || '—'}</div>
    <div><strong>Primary phone:</strong> ${obj.primaryPhone || '—'}</div>
    <div><strong>Secondary phone:</strong> ${obj.secondaryPhone || '—'}</div>
    <div><strong>Creator:</strong> ${obj.creatorName || '—'}</div>
    <div style="margin-top:6px; font-size:12px; color:#555">URL: ${obj.pageUrl || '—'}</div>
    <div style="font-size:12px; color:#777">Captured: ${obj.timestamp || '—'}</div>
  `;
  lastCaptureDiv.innerHTML = html;
}

// Load last capture on popup open
chrome.storage.local.get({ captures: [] }, (res) => {
  const caps = res.captures || [];
  const last = caps.length ? caps[caps.length - 1] : null;
  showLastCaptureUI(last);
});

// Run extraction inside the page using deterministic selectors (preferred) with fallbacks.
async function runExtractionInTab(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // --- Deterministic extraction logic running inside the page ---

      const selectors = {
        headerAutomation: '[data-sap-automation-id="objectDetail-Header-Name"], [data-help-id="objectDetail-Header-Name"], #__text3740',
        consumerAnchor: 'a[data-sap-automation-id="zCYjUwbe2qA6LriQDB4Aa0"]',
        creatorAnchor: 'a[data-sap-automation-id="RJZFlvx$74UQTT4$yKE1Dm"]'
      };

      function firstMatchText(sel) {
        const el = document.querySelector(sel);
        return el ? (el.getAttribute('title') || el.textContent || '').trim() : null;
      }

      function extractTicketIdFromHeader() {
        const header = document.querySelector(selectors.headerAutomation);
        if (header && header.textContent) {
          const m = header.textContent.match(/\b(\d{7})\b/);
          if (m) return { ticketId: m[1], headerElement: header };
        }
        // fallback: search whole document text for 7-digit number
        const docText = (document.body && document.body.innerText) || document.documentElement.innerText || '';
        const m2 = docText.match(/\b(\d{7})\b/);
        return { ticketId: m2 ? m2[1] : null, headerElement: null };
      }

      function isPhoneTitle(t) {
        return typeof t === 'string' && /^\+[\d\s\-()+]{4,}$/.test(t.trim());
      }

      // collect phones (first two) by scanning anchors with title starting with "+"
      function collectPhones() {
        const anchors = Array.from(document.querySelectorAll('a'));
        const phones = [];
        for (const a of anchors) {
          const title = (a.getAttribute('title') || a.textContent || '').trim();
          if (!title) continue;
          if (isPhoneTitle(title)) {
            phones.push(title);
            if (phones.length >= 2) break;
          }
        }
        return { primaryPhone: phones[0] || null, secondaryPhone: phones[1] || null };
      }

      // Try deterministic selectors first
      const ticketInfo = extractTicketIdFromHeader();
      const pageUrl = window.location.href;
      const title = document.title || null;

      // consumer by exact selector
      let consumer = firstMatchText(selectors.consumerAnchor);
      // creator by exact selector
      let creator = firstMatchText(selectors.creatorAnchor);

      // If deterministic selectors not found, fallback to previous heuristic:
      if (!consumer || consumer.length === 0) {
        // fallback heuristic: nearest name-like anchor to header
        try {
          const headerEl = ticketInfo.headerElement;
          const anchors = Array.from(document.querySelectorAll('a'));
          let best = null;
          let bestDist = Infinity;
          function domIndex(node) {
            const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT, null, false);
            let idx = 0;
            let cur = walker.nextNode();
            while (cur) {
              if (cur === node) return idx;
              idx++;
              cur = walker.nextNode();
            }
            return Number.MAX_SAFE_INTEGER;
          }
          function isNameLike(s) {
            if (!s) return false;
            if (isPhoneTitle(s)) return false;
            const trimmed = s.trim();
            return trimmed.length > 0 && trimmed.length <= 100 && /[a-zA-Z]/.test(trimmed);
          }
          const headerIdx = headerEl ? domIndex(headerEl) : null;
          for (const a of anchors) {
            const txt = (a.getAttribute('title') || a.textContent || '').trim();
            if (!isNameLike(txt)) continue;
            if (headerIdx == null) {
              if (!best) { best = txt; break; }
            } else {
              const idx = domIndex(a);
              const d = Math.abs(idx - headerIdx);
              if (d < bestDist) { bestDist = d; best = txt; }
            }
          }
          if (best) consumer = best;
        } catch (e) {
          // ignore fallback errors
        }
      }

      if (!creator || creator.length === 0) {
        // fallback heuristic: last name-like anchor on page that differs from consumer
        try {
          const anchors = Array.from(document.querySelectorAll('a')).reverse();
          function isNameLike(s) {
            if (!s) return false;
            if (isPhoneTitle(s)) return false;
            const trimmed = s.trim();
            return trimmed.length > 0 && trimmed.length <= 100 && /[a-zA-Z]/.test(trimmed);
          }
          for (const a of anchors) {
            const txt = (a.getAttribute('title') || a.textContent || '').trim();
            if (!isNameLike(txt)) continue;
            if (consumer && txt === consumer) continue;
            creator = txt;
            break;
          }
          // if still not found, fallback to consumer
          if (!creator) creator = consumer || null;
        } catch (e) {
          // ignore
        }
      }

      const phones = collectPhones();

      return {
        ticketId: ticketInfo.ticketId || null,
        consumerName: consumer || null,
        primaryPhone: phones.primaryPhone,
        secondaryPhone: phones.secondaryPhone,
        creatorName: creator || null,
        pageUrl,
        title,
        timestamp: new Date().toISOString()
      };
    }
  });

  return result.result;
}

captureBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      alert('No active tab found.');
      return;
    }

    const data = await runExtractionInTab(tab.id);

    if (
      !data ||
      (!data.ticketId &&
        !data.consumerName &&
        !data.primaryPhone &&
        !data.creatorName)
    ) {
      alert('Extractor ran but did not find values. Open the ticket detail page and try again.');
      console.warn('Extraction result:', data);
      return;
    }

    chrome.storage.local.get({ captures: [] }, (res) => {
      const captures = res.captures || [];
      captures.push(data);
      chrome.storage.local.set({ captures }, () => {
        showLastCaptureUI(data);
      });
    });
  } catch (err) {
    console.error('Error during capture:', err);
    alert('Error during capture. See console for details.');
  }
});

exportBtn.addEventListener('click', () => {
  chrome.storage.local.get({ captures: [] }, (res) => {
    const caps = res.captures || [];
    if (!caps.length) {
      alert('No captures to export.');
      return;
    }
    const header = [
      'ticketId',
      'consumerName',
      'primaryPhone',
      'secondaryPhone',
      'creatorName',
      'pageUrl',
      'title',
      'timestamp',
    ];
    const rows = caps.map((c) =>
      header
        .map((h) => {
          const v = c[h] == null ? '' : String(c[h]).replace(/"/g, '""');
          return `"${v}"`;
        })
        .join(',')
    );
    const csv = header.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const filename =
      'ticket_captures_' +
      new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_') +
      '.csv';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
});

clearBtn.addEventListener('click', () => {
  if (!confirm('Clear all saved captures?')) return;
  chrome.storage.local.set({ captures: [] }, () => {
    showLastCaptureUI(null);
  });
});
