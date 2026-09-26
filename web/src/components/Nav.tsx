import type { ComponentChildren } from 'preact';
import { IconBack } from './Icons';

export function Nav({ title, back, actions, subtitle }: { title: string; back?: string; actions?: ComponentChildren; subtitle?: ComponentChildren }) {
  return (
    <header class="nav">
      <div class="nav-row">
        {back ? (
          <a class="icon-btn" href={`#${back}`} aria-label="返回">
            <IconBack />
          </a>
        ) : null}
        <div class="grow" />
        {actions}
      </div>
      <h1 class="large-title">{title}</h1>
      {subtitle ? <div class="small muted">{subtitle}</div> : null}
    </header>
  );
}
