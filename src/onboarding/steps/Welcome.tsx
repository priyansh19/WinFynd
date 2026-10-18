import { useEffect, useState } from "react";
import { FileGlyph } from "../../components/FileIcon";
import { Icon } from "../../components/Icon";
import { kindClass } from "../../lib/kinds";
import type { ResultKind } from "../../lib/search";
import { Page, type StepProps } from "../Onboarding";

/** The live demo: a search, then what WinFynd finds for it, cycling every 3.2 s. */
const DEMOS: { query: string; rows: [name: string, why: string, kind: ResultKind][] }[] = [
  {
    query: "receipt for the blue sofa",
    rows: [
      ["Northwind_Order_88412.pdf", "Page 2 · sofa, navy, total paid", "document"],
      ["IMG_2041.jpg", "Looks like a printed receipt", "image"],
      ["Living room budget.xlsx", "Row 14 · Sofa $1,240", "spreadsheet"],
    ],
  },
  {
    query: "when did we agree the Q3 budget",
    rows: [
      ["Budget sync 2026-09-30.m4a", "Said at 12:05", "audio"],
      ["Q3 Budget review.pptx", "Slide 7 · budget by region", "slides"],
      ["Q3 planning notes.md", "Line 48 · budget signed off", "document"],
    ],
  },
  {
    query: "dog on the beach at sunset",
    rows: [
      ["PXL_20250812_191422.jpg", "Looks like dog, beach, sunset", "image"],
      ["Cornwall day 3.mp4", "Shown at 3:42", "video"],
      ["Cornwall trip plan.docx", "Mentions beach walk with Biscuit", "document"],
    ],
  },
];

const LEGEND: [string, string][] = [
  ["k-doc", "Documents"],
  ["k-img", "Photos"],
  ["k-audio", "Recordings"],
  ["k-video", "Videos"],
  ["k-slide", "Slides"],
  ["k-code", "Code"],
];

export function WelcomeStep({ next }: StepProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 3200);
    return () => window.clearInterval(t);
  }, []);
  const demo = DEMOS[tick % DEMOS.length];

  return (
    <Page
      footer={
        <>
          <span className="small muted">Setup takes about two minutes.</span>
          <span className="push" />
          <button type="button" className="btn accent big" onClick={next} autoFocus>
            Get started
          </button>
        </>
      }
    >
      <h1 className="welcome-title">Find anything on your PC by describing it.</h1>
      <p className="welcome-lede muted">
        Type or say what you remember. WinFynd finds the document, the photo or the moment in a recording, and it all runs on this PC.
      </p>
      <div className="panel demo" aria-hidden="true">
        <div className="demo-search">
          <Icon name="search" size={18} />
          <span>{demo.query}</span>
          <span className="caret" />
        </div>
        <div className="demo-rows" key={tick}>
          {demo.rows.map(([name, why, kind], i) => (
            <div key={name} className={`row ${kindClass(kind)}${i === 0 ? " on" : ""}`}>
              <FileGlyph path={name} kind={kind} size={28} />
              <div className="txt">
                <span className="n ellip">{name}</span>
                <span className="m ellip">{why}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="demo-legend small muted">
        {LEGEND.map(([cls, label]) => (
          <span key={cls}>
            <span className={`dot ${cls}`} />
            {label}
          </span>
        ))}
      </div>
    </Page>
  );
}
