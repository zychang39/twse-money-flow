import { Nav } from '../components/Nav';
import { IconChevron } from '../components/Icons';

const LINKS = [
  { path: '/more/weekly', label: '週報', desc: '本週分數、籌碼、風險旗標變化與下週事件' },
  { path: '/more/calendar', label: '行事曆', desc: '除權息、月營收公布日、法說會、融券最後回補日' },
  { path: '/more/disposition', label: '處置風險預警', desc: '注意股累計與可能進入處置的清單' },
  { path: '/backtest', label: '回測', desc: '預設訊號與自訂條件的歷史統計' },
  { path: '/more/health', label: '資料健康', desc: '各資料源狀態與最近執行紀錄' },
  { path: '/more/methodology', label: '方法說明', desc: '所有指標與分數的計算方式（依設定自動產生）' },
  { path: '/more/settings', label: '設定', desc: '分數權重、交易成本、外觀、提醒匯出' },
  { path: '/more/backup', label: '備份', desc: '匯出／匯入所有本機資料（單一 JSON）' },
];

export default function More() {
  return (
    <div>
      <Nav title="更多" />
      <div class="list">
        {LINKS.map((l) => (
          <a key={l.path} class="list-item" href={`#${l.path}`}>
            <div class="grow">
              <div>{l.label}</div>
              <div class="tiny muted">{l.desc}</div>
            </div>
            <span class="chev"><IconChevron /></span>
          </a>
        ))}
      </div>
    </div>
  );
}
