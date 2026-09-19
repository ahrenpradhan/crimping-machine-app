import { FAQ_SECTIONS } from '../data/faq';

/** Guide / FAQ: grouped by topic; tap a question to expand the answer. */
export function GuideScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen">
      <div className="screen__head">
        <h2>Guide / FAQ</h2>
        <button type="button" className="ghost-btn" onClick={onBack}>
          BACK
        </button>
      </div>
      <div className="faq">
        {FAQ_SECTIONS.map((section) => (
          <section key={section.title} className="faq__section">
            <h3 className="faq__title">{section.title}</h3>
            {section.items.map((item) => (
              <details key={item.q} className="faq__item">
                <summary>{item.q}</summary>
                {item.a.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </details>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
