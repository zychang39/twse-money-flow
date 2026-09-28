/**
 * 研究參考：近一年的法說會（公開資訊觀測站，含由說明文字擷取的主辦／邀請券商），
 * 以及查詢法說會簡報、券商報告與目標價新聞的連結。
 * 券商研究報告多為付費或只提供客戶，沒有官方免費來源；第三方網站只提供連結、不擷取內容，並清楚標示。
 */
import { IconChevron } from './Icons';

export interface Conference { date: string; time: string | null; place: string | null; text: string; host: string | null }

export function researchLinks(code: string, name: string, market: string | null | undefined): { label: string; sub: string; url: string; official: boolean }[] {
  const q = encodeURIComponent(`${code} ${name} 目標價 OR 研究報告`);
  return [
    { label: '公開資訊觀測站・法人說明會一覽表', sub: '官方；可下載各公司的法說會簡報', url: 'https://mopsov.twse.com.tw/mops/web/t100sb02_1', official: true },
    { label: `新聞搜尋：${name} 目標價、研究報告`, sub: 'Google 新聞（第三方搜尋結果，本 App 不擷取、不保證正確）', url: `https://news.google.com/search?q=${q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`, official: false },
    { label: `鉅亨網・${name}`, sub: '第三方網站：個股新聞與法人動態', url: `https://www.cnyes.com/twstock/${code}`, official: false },
    { label: `Yahoo 股市・${name} 新聞`, sub: '第三方網站：個股新聞', url: `https://tw.stock.yahoo.com/quote/${code}.${market === 'tpex' ? 'TWO' : 'TW'}/news`, official: false },
  ];
}

function md(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

export function Research({ code, name, market, conferences }: { code: string; name: string; market: string | null | undefined; conferences: Conference[] }) {
  const hosts = [...new Set(conferences.map((c) => c.host).filter((h): h is string => !!h))];
  return (
    <>
      {conferences.length ? (
        <div class="card rs-card">
          <div class="row between"><span class="caption w6">近一年法說會</span><span class="caption muted">公開資訊觀測站</span></div>
          {hosts.length ? <p class="caption t1 rs-hosts">主辦／邀請券商：{hosts.join('、')}</p> : null}
          <ul class="rs-list">
            {conferences.map((c) => (
              <li key={`${c.date}-${c.time}`} class="rs-item">
                <span class="rs-date num">{md(c.date)}</span>
                <span class="rs-body">
                  {c.host ? <span class="caption w6">{c.host}</span> : <span class="caption w6">公司自辦</span>}
                  <span class="caption muted rs-text">{c.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <p class="caption muted rs-note">主辦／邀請單位由公告文字擷取；「公司自辦」表示文字中沒有提到券商。</p>
        </div>
      ) : (
        <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>近一年沒有法說會紀錄（或資料尚未回補）。</p>
      )}
      <p class="caption muted rs-note">券商研究報告多為付費或只提供給客戶，沒有官方的免費來源，本 App 不擷取；以下連結另開新頁。</p>
      <ul class="list rs-links">
        {researchLinks(code, name, market).map((l) => (
          <li key={l.url}>
            <a class="list-item" href={l.url} target="_blank" rel="noopener noreferrer">
              <span class="grow"><span class="brand">{l.label}</span><span class="caption muted tool-sub">{l.sub}</span></span>
              <span class="chev"><IconChevron /></span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
