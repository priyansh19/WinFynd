// Sample data for the browser preview (`npm run dev`): the searches drawn on
// the design canvas, with the canvas's painted photos. Not used in the app.
import type { SearchResult } from "./search";

const t = (iso: string) => Math.round(new Date(iso).getTime() / 1000);
const U = "C:\\Users\\gupta";

type Hit = Omit<SearchResult, "id" | "confident"> & { confident?: boolean };
const hits = (list: Hit[]): SearchResult[] => list.map((h, i) => ({ id: i + 1, confident: true, ...h }));

function sunset(sunX: number, sunY: number, dogX: number, hue: number, running = false): string {
  const sky = [["#2d2a6e", "#c94f7c", "#ff9d5c"], ["#3a2c74", "#e0627a", "#ffb067"], ["#22285e", "#b5467f", "#ff8a57"]][hue];
  const legs = running ? "M4 9l-3 6M7 9l1 6M15 9l-2 6M18 9l3 5" : "M4 9v6M7 9v6M15 9v6M18 9v6";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".5" stop-color="${sky[1]}"/><stop offset=".64" stop-color="${sky[2]}"/></linearGradient></defs><rect width="160" height="100" fill="url(#s)"/><circle cx="${sunX}" cy="${sunY}" r="10" fill="#ffd89a"/><rect y="60" width="160" height="17" fill="#4b3a78"/><path d="M${sunX - 26} 64h52M${sunX - 16} 68h32M${sunX - 8} 72h16" stroke="#ffc98f" stroke-opacity=".55" stroke-width="1.2"/><path d="M0 77c40-5 95-4 160-1v24H0z" fill="#c38a5c"/><path d="M0 82c50-3 100-2 160 1" stroke="#d9a274" stroke-width="1" fill="none"/><g transform="translate(${dogX} 66)" fill="#1e1626"><ellipse cx="11" cy="7" rx="9" ry="4"/><circle cx="22" cy="2" r="3.6"/><path d="M24 1l4 1.5-3.5 2z"/><path d="M20.5 -0.5l-1 -3.5 2.6 2z"/><path d="M2.5 6c-2.5-1-4-3-4.5-5" stroke="#1e1626" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="${legs}" stroke="#1e1626" stroke-width="1.8" stroke-linecap="round"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const receipt = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice"><rect width="160" height="100" fill="#7a5236"/><path d="M0 64l160-26v62H0z" fill="#6a4630"/><path d="M0 20l160-6M0 46l160-8" stroke="#86603f" stroke-width="2"/><g transform="rotate(-7 80 50)"><rect x="54" y="6" width="52" height="88" fill="#f6f3ec"/><path d="M60 16h40M64 22h32M60 34h40M60 40h34M60 46h40M60 52h28M60 64h40M60 70h22" stroke="#9a978f" stroke-width="2"/></g></svg>',
)}`;

const PHOTOS = [
  ["PXL_20250812_191422.jpg", sunset(104, 56, 40, 0)],
  ["PXL_20250812_191506.jpg", sunset(118, 52, 70, 1, true)],
  ["PXL_20250812_191533.jpg", sunset(92, 60, 96, 2)],
  ["PXL_20250812_190958.jpg", sunset(84, 58, 24, 0, true)],
  ["PXL_20250812_191611.jpg", sunset(126, 62, 52, 1)],
  ["PXL_20250812_191702.jpg", sunset(70, 54, 110, 2, true)],
] as const;

export const PREVIEW_IMAGES: Record<string, string> = {
  [`${U}\\Pictures\\Receipts\\IMG_2041.jpg`]: receipt,
  ...Object.fromEntries(PHOTOS.map(([name, url]) => [`${U}\\Pictures\\Cornwall 2025\\${name}`, url])),
};

export const PREVIEW_RESULTS: { words: string[]; hits: SearchResult[] }[] = [
  {
    words: ["sofa", "receipt"],
    hits: hits([
      {
        kind: "document", name: "Northwind_Order_88412.pdf", path: `${U}\\Documents\\Home\\Receipts\\Northwind_Order_88412.pdf`,
        size: 188_416, modified: t("2026-03-14T18:22:00"), location: "Page 2",
        snippet:
          "Northwind Home · Order 88412. Harlow 3-seat sofa, navy velvet, 1, $1,240.00. Harlow scatter cushions, set of 2, $64.00. White-glove delivery and setup, $89.00. Subtotal $1,393.00. Total paid $1,393.00. Paid by Visa ending 4417 on 14 March 2026. Delivery booked for 21 March, 8 am to 12 pm.",
        reason: "Exact words on page 2",
      },
      { kind: "image", name: "IMG_2041.jpg", path: `${U}\\Pictures\\Receipts\\IMG_2041.jpg`, size: 2_900_000, modified: t("2026-03-14T18:40:00"), location: null, snippet: null, reason: "Image matches your search" },
      {
        kind: "spreadsheet", name: "Living room budget.xlsx", path: `${U}\\Documents\\Home\\Living room budget.xlsx`, size: 24_000, modified: t("2026-03-02T09:10:00"),
        location: "Sheet Furniture", snippet: "Row 14: Sofa $1,240, cushions $64, delivery $89. Rug $310.", reason: "Exact words on sheet furniture",
      },
      {
        kind: "document", name: "Your Northwind order has shipped.eml", path: `${U}\\Documents\\Mail\\Your Northwind order has shipped.eml`, size: 41_000, modified: t("2026-03-18T07:55:00"),
        location: null, snippet: "Mail export. Your Harlow sofa is on its way, delivery 21 March between 8 am and 12 pm.", reason: "Matches the meaning",
      },
      {
        kind: "document", name: "Moving checklist.docx", path: `${U}\\Documents\\Home\\Moving checklist.docx`, size: 19_000, modified: t("2026-02-26T21:02:00"),
        location: null, snippet: "Book sofa delivery window, measure the hallway, cancel the old broadband.", reason: "Exact words match",
      },
    ]),
  },
  {
    words: ["dog", "beach", "sunset"],
    hits: hits([
      ...PHOTOS.map(([name], i) => ({
        kind: "image" as const, name, path: `${U}\\Pictures\\Cornwall 2025\\${name}`, size: 3_984_000 - i * 61_000,
        modified: t("2025-08-12T19:14:00"), location: null, snippet: null, reason: "Image matches your search",
      })),
      {
        kind: "video", name: "Cornwall day 3.mp4", path: `${U}\\Videos\\Cornwall 2025\\Cornwall day 3.mp4`, size: 412_000_000, modified: t("2025-08-12T20:02:00"),
        location: "3:42", snippet: null, reason: "Shown at 3:42",
      },
      {
        kind: "document", name: "Cornwall trip plan.docx", path: `${U}\\Documents\\Travel\\Cornwall trip plan.docx`, size: 31_000, modified: t("2025-07-30T22:15:00"),
        location: null, snippet: "Day 3: Porthcurno. Sunset beach walk with Biscuit, then dinner in Mousehole.", reason: "Exact words match",
      },
    ]),
  },
  {
    words: ["q3", "budget"],
    hits: hits([
      {
        kind: "audio", name: "Budget sync 2026-09-30.m4a", path: `${U}\\Documents\\Recordings\\Budget sync 2026-09-30.m4a`, size: 36_800_000, modified: t("2026-09-30T10:00:00"),
        location: "12:05", snippet: "Priya: Then let's lock it. Q3 budget agreed at 2.4 million, and North gets the extra 150.", reason: "Said at 12:05, exact words",
      },
      {
        kind: "slides", name: "Q3 Budget review.pptx", path: `${U}\\Documents\\Work\\Q3 Budget review.pptx`, size: 6_400_000, modified: t("2026-10-01T16:40:00"),
        location: "Slide 7", snippet: "Approved budget by region: North 640, South 580, East 610, West 570.", reason: "Exact words on slide 7",
      },
      {
        kind: "video", name: "All-hands September.mp4", path: `${U}\\Videos\\All-hands September.mp4`, size: 920_000_000, modified: t("2026-09-26T17:30:00"),
        location: "41:18", snippet: "The Q3 budget is final as of this week.", reason: "Said at 41:18, exact words",
      },
      {
        kind: "document", name: "Q3 planning notes.md", path: `${U}\\Documents\\Work\\Q3 planning notes.md`, size: 8_000, modified: t("2026-09-30T11:12:00"),
        location: "Line 48", snippet: "Q3 budget signed off 30 Sep in the budget sync.", reason: "Exact words on line 48",
      },
    ]),
  },
];
