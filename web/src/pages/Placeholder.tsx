import { Nav } from '../components/Nav';

export default function Placeholder({ title, back }: { title: string; back?: string }) {
  return (
    <div>
      <Nav title={title} back={back} />
      <div class="empty">此功能建置中。</div>
    </div>
  );
}
