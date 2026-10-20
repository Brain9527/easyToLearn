import { BookOpenText, ChartColumnBig, CircleAlert, FileSpreadsheet, GraduationCap, Settings2 } from 'lucide-preact';

export type AppView = 'vocabulary' | 'learning' | 'mistakes';

interface AppLayoutProps {
  view: AppView;
  onChangeView: (view: AppView) => void;
  stats: { label: string; value: string | number }[];
  title: string;
  subtitle: string;
  children: preact.ComponentChildren;
  aside: preact.ComponentChildren;
}

const items: { key: AppView; label: string; icon: typeof BookOpenText }[] = [
  { key: 'vocabulary', label: '单词列表', icon: BookOpenText },
  { key: 'learning', label: '学习', icon: GraduationCap },
  { key: 'mistakes', label: '错题本', icon: CircleAlert },
];

function NavButtons({ view, onChangeView }: Pick<AppLayoutProps, 'view' | 'onChangeView'>) {
  return (
    <>
      {items.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className={view === key ? 'navItem active' : 'navItem'}
          aria-current={view === key ? 'page' : undefined}
          onClick={() => onChangeView(key)}
        >
          <Icon size={18} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </>
  );
}

export function AppLayout({ view, onChangeView, stats, title, subtitle, children, aside }: AppLayoutProps) {
  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandLogo" aria-hidden="true">简</div>
          <div>
            <strong>简单学</strong>
            <span>English Learning</span>
          </div>
        </div>
        <nav className="navList" aria-label="主导航">
          <NavButtons view={view} onChangeView={onChangeView} />
        </nav>
        <div className="sidebarFoot">
          <div className="miniHint"><FileSpreadsheet size={16} /> 支持 XLSX / XLS / CSV</div>
          <div className="miniHint"><ChartColumnBig size={16} /> 统计由本地记录实时计算</div>
          <div className="miniHint"><Settings2 size={16} /> 数据仅保存在本地浏览器</div>
        </div>
      </aside>
      <main className="contentShell">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="statsGrid">
            {stats.map((item) => (
              <div key={item.label} className="statCard">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </header>
        <div className="pageGrid">
          <section className="mainPanel">{children}</section>
          <aside className="sidePanel">{aside}</aside>
        </div>
      </main>
      <nav className="mobileNav" aria-label="底部导航">
        <NavButtons view={view} onChangeView={onChangeView} />
      </nav>
    </div>
  );
}
