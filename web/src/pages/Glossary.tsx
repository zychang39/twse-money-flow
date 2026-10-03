/** 名詞表（設定 → 名詞表；說明面板底部「查看全部名詞」）：可搜尋，點名詞開說明面板。 */
import { useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { List, PageTitle, Row } from '../components/ui';
import { openHelp } from '../components/kit';
import { TERMS, searchTerms } from '../lib/glossary';

export default function Glossary() {
  const [q, setQ] = useState('');
  const list = searchTerms(q);
  return (
    <div class="page">
      <TopBar back="/me/settings" />
      <PageTitle title="名詞表" sub={`${TERMS.length} 個名詞・點名詞看白話與進階說明`} />
      <div class="ui-sec">
        <input class="input glossary-search" type="search" placeholder="搜尋名詞" value={q} aria-label="搜尋名詞"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)} data-testid="glossary-search" />
        <List chev testid="glossary-list" class="glossary-list">
          {list.length ? list.map((t) => (
            <Row key={t.id} label={t.name} sub={t.plain} subWide onClick={() => openHelp(t.id)} testid={`term-${t.id}`} />
          )) : <Row label="找不到符合的名詞" />}
        </List>
      </div>
    </div>
  );
}
