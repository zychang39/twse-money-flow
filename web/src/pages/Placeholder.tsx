import { PageHead, TopBar } from '../components/Chrome';
import { EmptyState } from '../components/DataStatus';

export default function Placeholder({ title, back = '/' }: { title: string; back?: string }) {
  return (
    <div class="page">
      <TopBar back={back} />
      <PageHead title={title} />
      <EmptyState title="這個頁面不存在" text="網址可能已經改變。" action={<a class="btn primary" href={`#${back}`}>返回</a>} />
    </div>
  );
}
