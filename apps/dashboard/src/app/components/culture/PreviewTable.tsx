import type { CulturePreview, CulturePreviewResult } from "@emojisense/platform";

const LOCALE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });
const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

const localeName = (code: string) => LOCALE_NAMES.of(code) ?? code;
const regionName = (code: string) => REGION_NAMES.of(code) ?? code;

/** A result row as glyphs; emoji the culture layer added or moved are marked. */
function Glyphs({ results, label }: { results: CulturePreviewResult[]; label: string }) {
  if (results.length === 0) return <span className="hint">No results</span>;
  return (
    <ol className="glyphs" aria-label={label}>
      {results.map((result) => (
        <li
          key={result.hexcode}
          className="glyph emoji"
          data-culture={result.culture || undefined}
          title={result.culture ? `${result.hexcode}, added by this entry` : result.hexcode}
        >
          {result.emoji}
          {result.culture && <span className="visually-hidden"> (added)</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The live preview of an entry: for each targeted locale and trigger, what search returns now and
 * with the entry (window ignored), and in one region inside and one outside its scope.
 */
export function PreviewTable({ preview, busy }: { preview: CulturePreview; busy: boolean }) {
  const withRegions = preview.locales.some((l) => l.triggers.some((t) => t.regions?.length));
  return (
    <div className="culture-preview" aria-busy={busy}>
      {preview.locales.map((locale) => (
        <section
          key={locale.locale}
          className="culture-preview-locale"
          aria-label={localeName(locale.locale)}
        >
          <p className="section-label">
            {localeName(locale.locale)} <span className="mono">{locale.locale}</span>
            {locale.context && <span className="culture-context"> · {locale.context}</span>}
          </p>
          {locale.triggers.length === 0 ? (
            <p className="hint">No triggers in this language: the entry adds nothing here.</p>
          ) : (
            <div className="table-wrap">
              <table className="table culture-preview-table">
                <thead>
                  <tr>
                    <th scope="col">Trigger</th>
                    <th scope="col">Now</th>
                    <th scope="col">With the entry</th>
                    {withRegions && <th scope="col">By region</th>}
                  </tr>
                </thead>
                <tbody>
                  {locale.triggers.map((row) => (
                    <tr key={row.trigger}>
                      <th scope="row" className="mono culture-trigger">
                        {row.trigger}
                        {row.note === "no-canonical" && (
                          <span className="culture-note" data-tone="bad">
                            No canonical answer: the entry would be the top answer
                          </span>
                        )}
                        {row.note === "adds-nothing" && (
                          <span className="culture-note">Adds nothing new</span>
                        )}
                      </th>
                      <td>
                        <Glyphs results={row.canonical} label={`Now: ${row.trigger}`} />
                      </td>
                      <td>
                        <Glyphs results={row.boosted} label={`With the entry: ${row.trigger}`} />
                      </td>
                      {withRegions && (
                        <td className="culture-regions">
                          {(row.regions ?? []).map((region) => (
                            <div key={region.region} className="culture-region">
                              <span
                                className={region.inScope ? "badge badge-solid" : "badge badge-dashed"}
                                title={regionName(region.region)}
                              >
                                {region.inScope ? "In" : "Not in"} {region.region}
                              </span>
                              <Glyphs
                                results={region.results}
                                label={`${regionName(region.region)}: ${row.trigger}`}
                              />
                            </div>
                          ))}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
