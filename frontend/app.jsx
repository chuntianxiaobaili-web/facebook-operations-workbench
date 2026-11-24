import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Badge } from '@astryxdesign/core/Badge';
import { Button, Empty, Icon } from './controls.jsx';
import {
  Block,
  F,
  Form,
  Pill,
  ProfileForm,
  Records,
  SafeLink,
  tr,
} from './records.jsx';

const pages = {
  dashboard: ['运营总览', '查看当前账号的工作队列与跟进事项。', 'dashboard'],
  content: ['内容与审核', '从选题、审核和排期，追踪到已发布内容。', 'content'],
  interaction: [
    '互动与销售',
    '保留来源与买家原话，记录客户意图和下一次跟进。',
    'interactions',
  ],
  group: ['小组运营', '按小组记录受众、参与方式与组规。', 'groups'],
  learning: [
    '经验库',
    '将有证据的方法提交复核，采纳后存入当前账号的知识库。',
    'learning',
  ],
  report: [
    '运营报告',
    '按内容回执、客户阶段与归因来源查看运营结果。',
    'report',
  ],
  profile: [
    '账号与连接',
    '管理客户档案、公共主页身份与销售工作台连接。',
    'profile',
  ],
};
const makeAllowed = (t) =>
  typeof t === 'string' &&
  /^[a-z0-9][a-z0-9_-]{0,47}$/.test(t) &&
  !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(t);
function readLocal(k, fallback) {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* Workspace remains usable without browser preferences. */
  }
}
const initialTenant = () => {
  const t =
    new URL(location.href).searchParams.get('tenant') ||
    readLocal('fbops.account', 'default');
  return makeAllowed(t) ? t : 'default';
};
async function api(tenant, action, body, signal) {
  const opts = { cache: 'no-store', signal };
  if (body !== undefined)
    Object.assign(opts, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const res = await fetch(
    '/api/' + encodeURIComponent(tenant) + '/' + action,
    opts,
  );
  const data = await res
    .json()
    .catch(() => ({ error: '本地服务返回了无法读取的内容。' }));
  if (!res.ok || data.error) throw Error(data.error || '本地服务暂时不可用。');
  return data;
}
function AccountSwitcher({ s, select, known, busy }) {
  return (
    <>
      <Form
        title="打开账号工作区"
        fields={[
          F('tenant', '账号代号', {
            required: true,
            placeholder: '例如：studio-a',
            hint: '输入已有代号打开记录。新代号将建立独立工作区。使用 1–48 位小写字母、数字、下划线或连字符，首位为字母或数字。',
            wide: true,
          }),
        ]}
        submit="打开工作区"
        busy={busy}
        onSave={({ tenant }) => select(tenant)}
      />
      {known.length > 0 && (
        <Block title="此浏览器最近使用">
          <div className="chips">
            {known.map((t) => (
              <button
                className="tag-button"
                key={t}
                onClick={() => select(t)}
                disabled={busy}
              >
                {t}
                {t === s.tenant ? ' · 当前' : ''}
              </button>
            ))}
          </div>
        </Block>
      )}
    </>
  );
}
function Dashboard({ s, go }) {
  const { counts: c, followups, ideas } = s.report;
  const metrics = [
    ['待审核草稿', c.draft, 'content'],
    ['已登记发布', c.published, 'content'],
    ['强意向信号', c.strong, 'interaction'],
    ['已识别公司', c.companies, 'report'],
  ];
  const queues = [
    ['content', '内容审核', c.draft + ' 篇草稿'],
    ['interactions', '互动跟进', followups.length + ' 项跟进'],
    [
      'learning',
      '方法复核',
      s.learning.filter((x) => x.status === 'pending').length + ' 条待复核',
    ],
  ];
  return (
    <>
      <div className="metrics">
        {metrics.map(([name, n, page]) => (
          <button className="metric" key={name} onClick={() => go(page)}>
            <span className="metric-label">{name}</span>
            <b className="metric-value">{n}</b>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <Block title="工作队列" icon="dashboard">
          {queues.map(([icon, name, count], i) => (
            <button
              className="queue-link"
              key={name}
              onClick={() => go(['content', 'interaction', 'learning'][i])}
            >
              <span className="queue-icon">
                <Icon name={icon} />
              </span>
              <strong>{name}</strong>
                <Badge variant="neutral" label={count} />
              <Icon name="next" size={14} />
            </button>
          ))}
        </Block>
        <Block title="近期跟进" icon="clock">
          {followups.length ? (
            followups.slice(0, 4).map((r) => (
              <button
                className="recent-row"
                key={r.id}
                onClick={() =>
                  go('interaction', {
                    action: 'edit',
                    row: s.interactions.find((x) => x.id === r.id),
                  })
                }
              >
                <div className="rec-main">
                  <b>{r.company || '客户互动'}</b>
                  <span className="rec-sub">
                    {r.nextAction}
                    {r.followupAt
                      ? ' · ' +
                        new Date(r.followupAt).toLocaleDateString('zh-CN')
                      : ''}
                  </span>
                </div>
                <Icon name="next" size={14} />
              </button>
            ))
          ) : (
            <Empty
              action={
                <Button
                  small
                  onClick={() => go('interaction', { action: 'new' })}
                >
                  登记互动
                </Button>
              }
            >
              尚无待跟进事项
            </Empty>
          )}
        </Block>
        <Block title="由互动产生的选题" icon="content">
          {ideas.length ? (
            ideas.slice(0, 4).map((r) => (
              <button
                className="recent-row"
                key={r.interactionId}
                onClick={() =>
                  go('content', {
                    action: 'new',
                    row: {
                      sourceInteractionId: r.interactionId,
                      title: r.topic,
                    },
                  })
                }
              >
                <div className="rec-main">
                  <b>{r.topic}</b>
                  <span className="rec-sub">以此互动创建草稿</span>
                </div>
                <Icon name="next" size={14} />
              </button>
            ))
          ) : (
            <Empty>有来源链接的客户问题将出现在这里。</Empty>
          )}
        </Block>
        <Block title="内容排期" icon="clock">
          {s.report.calendar.length ? (
            s.report.calendar.slice(0, 4).map((r) => (
              <div className="recent-row" key={r.id}>
                <div className="rec-main">
                  <b>{r.title}</b>
                  <span className="rec-sub">
                    {new Date(r.scheduledAt).toLocaleString('zh-CN')} ·{' '}
                    {tr(r.surface)}
                  </span>
                </div>
                <Pill value="scheduled" />
              </div>
            ))
          ) : (
            <Empty>当前账号暂无已排期内容。</Empty>
          )}
        </Block>
      </div>
    </>
  );
}
const stageLabels = {
  observed: '待研判',
  inquiry: '已询盘',
  handed_off: '已交接',
  quoted: '已报价',
  won: '已成交',
};
function Report({ s, mutate, busy }) {
  const [period, setPeriod] = useState(null);
  return (
    <>
      <Block
        title="公司销售阶段"
        icon="report"
        side={<small>按公司去重，计入最高阶段</small>}
      >
        <div className="kvs">
          {Object.entries(stageLabels).map(([k, l]) => (
            <div key={k} className="kv">
              <span>{l}</span>
              <strong>{s.report.funnel[k]}</strong>
            </div>
          ))}
        </div>
        <p className="muted quick-row">
          {s.report.counts.unidentified} 条互动尚未识别公司。
        </p>
      </Block>
      <Block title="来源归因">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {['来源', '互动', '强信号', '询盘', '交接', '报价', '成交'].map(
                  (x) => (
                    <th key={x}>{x}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.report.attribution).map(([k, r]) => (
                <tr key={k}>
                  <th>{tr(k)}</th>
                  {[
                    'interactions',
                    'strong',
                    'inquiry',
                    'handed_off',
                    'quoted',
                    'won',
                  ].map((n) => (
                    <td key={n}>{r[n]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
      <Block
        title="近七天回顾"
        side={
          <Button
            small
            disabled={busy}
            onClick={async () => {
              const r = await mutate('weekly', {});
              if (r) setPeriod(r);
            }}
          >
            生成近七天报告
          </Button>
        }
      >
        {period ? (
          <>
            <p className="muted">
              {new Date(period.from).toLocaleString('zh-CN')} 至{' '}
              {new Date(period.toExclusive).toLocaleString('zh-CN')}
            </p>
            <div className="kvs quick-row">
              {[
                ['已登记发布', period.published.length],
                ['入站互动', period.interactions],
                ['强信号', period.strongSignals],
              ].map(([l, n]) => (
                <div className="kv" key={l}>
                  <span>{l}</span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
            <p className="note">{period.basis}</p>
          </>
        ) : (
          <p className="muted">按发生或登记时间汇总本期工作。</p>
        )}
      </Block>
      <Block title="已登记发布的回执">
        {s.report.receipts.length ? (
          [...s.report.receipts].reverse().map((r) => (
            <div key={r.id} className="recent-row">
              <div className="rec-main">
                <b>{r.title}</b>
                <span className="rec-sub">
                  {tr(r.surface)} · {r.remoteId}
                </span>
              </div>
              <SafeLink value={r.permalink}>查看原帖</SafeLink>
            </div>
          ))
        ) : (
          <Empty>暂无已登记的发布回执。</Empty>
        )}
      </Block>
    </>
  );
}
function Workspace({ tenant, onTenant, known }) {
  const [s, setState] = useState(null),
    [page, setPage] = useState('dashboard'),
    [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [notice, setNotice] = useState(null),
    [attempt, setAttempt] = useState(0);
  const alive = useRef(true),
    lock = useRef(false),
    pending = useRef(null);
  useEffect(() => {
    alive.current = true;
    const c = new AbortController();
    api(tenant, 'state', undefined, c.signal)
      .then((data) => {
        if (data.tenant !== tenant)
          throw Error('服务返回的账号与当前工作区不一致。');
        setState(data);
        setNotice(null);
      })
      .catch((e) => {
        if (!c.signal.aborted) setNotice({ error: true, text: e.message });
      });
    return () => {
      alive.current = false;
      c.abort();
    };
  }, [tenant, attempt]);
  async function mutate(action, body) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    let committed = false;
    try {
      const local = [
        'content',
        'interaction',
        'group',
        'learning',
        'review',
        'profile',
      ].includes(action);
      const signature = JSON.stringify([action, body]);
      if (local && pending.current?.signature !== signature)
        pending.current = { signature, id: crypto.randomUUID() };
      const r = await api(
        tenant,
        action,
        local ? { ...body, requestId: pending.current.id } : body,
      );
      committed = true;
      const next = await api(tenant, 'state');
      if (next.tenant !== tenant) throw Error('账号验证失败。');
      if (alive.current) {
        pending.current = null;
        setState(next);
        setNotice({
          text: ['meta-check', 'weekly', 'sales-sync'].includes(action)
            ? '已读取最新结果。'
            : '已保存至当前账号。',
        });
      }
      return r;
    } catch (e) {
      if (alive.current)
        setNotice({
          error: true,
          text:
            (committed ? '操作已完成，刷新数据时遇到问题。' : '') + e.message,
        });
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function go(next, m = null) {
    if (lock.current) return;
    setPage(next);
    setMode(m);
    setNotice(null);
    setMobile(false);
    window.scrollTo({ top: 0 });
  }
  function select(t) {
    if (!makeAllowed(t)) {
      setNotice({ error: true, text: '代号格式无效或属于系统保留名称。' });
      return;
    }
    if (tenant === t) go('profile');
    else onTenant(t);
  }
  const label = s?.profile?.name || tenant,
    info = pages[page] || ['切换账号', '打开一个独立的客户工作区。', 'profile'];
  useEffect(() => {
    function esc(e) {
      if (e.key === 'Escape') setMobile(false);
    }
    if (mobile) document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [mobile]);
  return (
    <>
      <header className="top">
        <div className="brand-left">
          <button
            className="mobile-menu"
            aria-label="打开导航"
            aria-expanded={mobile}
            onClick={() => setMobile(!mobile)}
          >
            <Icon name={mobile ? 'close' : 'menu'} />
          </button>
          <div className="brand">
            <span className="brand-mark">
              <Icon name="layers" size={19} />
            </span>
            Facebook 运营工作台
          </div>
        </div>
        <span className="top-state">
          <span className="signal-dot" />
          本地工作区
        </span>
      </header>
      <div className="shell">
        {mobile && (
          <button
            className="menu-shade"
            aria-label="关闭导航"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={'side' + (mobile ? ' open' : '')}>
          <button
            className="account-switch"
            aria-label="切换账号"
            onClick={() => go('switch')}
          >
            <span className="avatar">{label.slice(0, 1).toUpperCase()}</span>
            <span className="tenant-copy">
              <b>{label}</b>
              <small>{tenant}</small>
            </span>
            <Icon name="down" size={13} />
          </button>
          <nav className="nav" aria-label="运营导航">
            {Object.entries(pages).map(([id, [title, , icon]]) => (
              <React.Fragment key={id}>
                {id === 'profile' && <hr className="nav-rule" />}
                <button
                  className="nav-entry"
                  aria-current={page === id ? 'page' : undefined}
                  onClick={() => go(id)}
                >
                  <Icon name={icon} />
                  {title}
                </button>
              </React.Fragment>
            ))}
          </nav>
        </aside>
        <main className="main">
          <p className="path">
            <Icon name="layers" size={13} />
            {label}
            <Icon name="next" size={11} />
            {info[0]}
          </p>
          <div className="heading">
            <div>
              <h1>{info[0]}</h1>
              <p>{info[1]}</p>
            </div>
            {s && page === 'dashboard' && (
              <Button primary onClick={() => go('content', { action: 'new' })}>
                <Icon name="plus" size={15} />
                新建内容
              </Button>
            )}
          </div>
          {notice && (
            <div
              className={'notice' + (notice.error ? ' error' : '')}
              role={notice.error ? 'alert' : 'status'}
            >
              <span>{notice.text}</span>
              <button
                className="dismiss"
                aria-label="关闭提示"
                onClick={() => setNotice(null)}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          {!s ? (
            <div className="section">
              <p>{notice ? '工作区加载失败。' : '正在打开账号工作区…'}</p>
              {notice && (
                <Button onClick={() => setAttempt((v) => v + 1)}>
                  重新加载
                </Button>
              )}
            </div>
          ) : page === 'dashboard' ? (
            <Dashboard s={s} go={go} />
          ) : page === 'switch' ? (
            <AccountSwitcher s={s} select={select} known={known} busy={busy} />
          ) : page === 'profile' ? (
            <ProfileForm s={s} mutate={mutate} busy={busy} />
          ) : page === 'report' ? (
            <Report s={s} mutate={mutate} busy={busy} />
          ) : (
            <>
              <Records
                key={page}
                type={page}
                s={s}
                mode={mode}
                setMode={setMode}
                busy={busy}
                mutate={mutate}
              />
              {page === 'learning' && (
                <Block title="当前账号的 Obsidian 仓库">
                  <p className="muted">
                    在 Obsidian 中选择“打开本地仓库”，并选择以下文件夹。
                  </p>
                  <p className="note">{s.vaultPath}</p>
                </Block>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
function App() {
  const [tenant, setTenant] = useState(initialTenant);
  const remembered = readLocal('fbops.recent', []);
  const known = [
    ...new Set(
      [tenant, ...(Array.isArray(remembered) ? remembered : [])].filter(
        makeAllowed,
      ),
    ),
  ].slice(0, 24);
  useEffect(() => {
    writeLocal('fbops.account', tenant);
    writeLocal('fbops.recent', known);
  }, [tenant]);
  useEffect(() => {
    const back = () => setTenant(initialTenant());
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  const switchTo = (id) => {
    const u = new URL(location.href);
    u.searchParams.set('tenant', id);
    history.pushState({}, '', u);
    setTenant(id);
  };
  return (
    <Workspace key={tenant} tenant={tenant} onTenant={switchTo} known={known} />
  );
}
createRoot(document.getElementById('root')).render(<App />);
