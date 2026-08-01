// src/components/ImportScreen/ExportSteps.tsx
//
// The instructions on the drop screen. Everything here is a picture of a phone
// screen the reader is about to look at for real: the point is that they
// recognise the step when they get to it, not that they memorise a sentence.
//
// The drawings are deliberately line-art rather than screenshots of WhatsApp —
// screenshots would be someone else's copyrighted UI, and they rot every time
// WhatsApp moves a menu. A drawing that shows *where* to look survives that.

/** Where "Export chat" hides: behind the chat's own name, at the bottom of a long menu. */
function MenuGlyph() {
  return (
    <svg viewBox="0 0 120 96" className="step-art" aria-hidden="true">
      <g className="art-zoom">
        <rect className="art-screen" x="26" y="6" width="68" height="84" rx="9" />
        {/* chat header: back chevron, avatar, the tappable name */}
        <path className="art-line" d="M35 19l-3.5 3.5L35 26" />
        <circle className="art-line" cx="45" cy="22.5" r="4.5" />
        <path className="art-accent-strong" d="M53 20.5h22" />
        <path className="art-faint" d="M53 25.5h13" />
        {/* the menu that opens, with the last row picked out */}
        <rect className="art-panel" x="44" y="34" width="46" height="46" rx="5" />
        <path className="art-faint" d="M51 44h26M51 53h30M51 62h22" />
        <rect className="art-accent-fill" x="46" y="66.5" width="42" height="11" rx="3" />
        <rect className="art-accent-fill-solid" x="46" y="66.5" width="2.5" height="11" rx="1.25" />
        <path className="art-accent-strong" d="M53 72h22" />
      </g>
    </svg>
  )
}

/** The media choice — the one that quietly costs you every photo. */
function MediaChoiceGlyph() {
  return (
    <svg viewBox="0 0 120 96" className="step-art" aria-hidden="true">
      <g className="art-zoom">
        <rect className="art-screen" x="26" y="6" width="68" height="84" rx="9" />
        <rect className="art-panel" x="34" y="26" width="52" height="44" rx="5" />
        {/* chosen: attach media — a tiny photo, sun over a hill */}
        <rect className="art-accent-fill" x="36" y="32" width="48" height="16" rx="3" />
        <circle className="art-accent-strong" cx="43" cy="40" r="4.8" />
        <circle className="art-accent-fill-solid" cx="43" cy="40" r="2.6" />
        <rect className="art-accent-line" x="52" y="34.5" width="11" height="11" rx="2" />
        <circle className="art-accent-fill-solid" cx="55.5" cy="38" r="1.3" />
        <path className="art-accent-line" d="M52.5 43.5l3-2.6 3 2.5 2-1.6 2.4 2.2" />
        <path className="art-accent-strong" d="M67 40h12" />
        {/* not chosen: without media */}
        <circle className="art-faint-stroke" cx="43" cy="57" r="4.8" />
        <path className="art-faint" d="M52 57h27" />
      </g>
    </svg>
  )
}

/** Phone to laptop, and into the dashed square directly above this drawing. */
function TransferGlyph() {
  return (
    <svg viewBox="0 0 120 96" className="step-art" aria-hidden="true">
      <g className="art-zoom art-zoom--wide">
        <rect className="art-screen" x="8" y="18" width="32" height="56" rx="6" />
        <path className="art-faint" d="M16 32h16M16 40h12" />
        {/* the file, mid-flight */}
        <path className="art-accent-line" d="M54 36h10l5 5v14H54z" />
        <path className="art-accent-line" d="M64 36v5h5" />
        <path className="art-accent-strong" d="M44 46h3.5M50 46h1.5" />
        {/* laptop, lid open, with the drop target on its screen */}
        <path className="art-line" d="M78 26h32v28H78z" />
        <path className="art-line" d="M73 59h42l-4-5H77z" />
        <rect className="art-accent-dashed" x="85" y="33" width="18" height="14" rx="2" />
        <path className="art-accent-strong" d="M94 36v7M90.5 39.5l3.5 3.5 3.5-3.5" />
      </g>
    </svg>
  )
}

const STEPS = [
  {
    art: <MenuGlyph />,
    title: 'Export the chat',
    body: (
      <>
        In WhatsApp on your phone, open the chat, tap its <b>name</b> at the top, scroll to the
        bottom and choose <b>Export chat</b>.
      </>
    ),
  },
  {
    art: <MediaChoiceGlyph />,
    title: 'Keep the photos',
    body: (
      <>
        Choose <b>Attach media</b>. “Without media” gives you every message and none of the
        pictures.
      </>
    ),
  },
  {
    art: <TransferGlyph />,
    title: 'Bring it here',
    body: (
      <>
        Send the file to yourself — email, Drive, AirDrop — save it on this computer, then drop it
        above.
      </>
    ),
  },
]

export function ExportSteps() {
  return (
    <div className="export-steps">
      <h2 className="export-steps-title">Don’t have the file yet?</h2>

      <ol className="export-steps-strip">
        {STEPS.map((step, i) => (
          <li className="export-step" key={step.title} style={{ '--i': i } as React.CSSProperties}>
            <div className="step-art-frame">
              {step.art}
              <span className="step-number" aria-hidden="true">
                {i + 1}
              </span>
            </div>
            <h3 className="step-title">{step.title}</h3>
            <p className="step-body">{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="export-steps-footer">
        <a
          className="export-steps-link"
          href="https://faq.whatsapp.com/1180414079177245/"
          target="_blank"
          rel="noopener noreferrer"
          // The whole card is a click target for the file picker; without this,
          // following the link would also pop a file dialog behind the new tab.
          onClick={(e) => e.stopPropagation()}
        >
          WhatsApp’s own instructions, with screenshots
        </a>
        <p className="export-steps-note">
          A long chat takes a few minutes to export, and WhatsApp splits very large ones. Nothing
          you drop here is uploaded — it is read on this computer and stays here.
        </p>
      </div>
    </div>
  )
}
