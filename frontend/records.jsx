import React, { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button, Empty, Field, Icon } from './controls.jsx';

const choices = (obj) => Object.entries(obj);
const surfaces = { page: '公共主页', profile: '个人主页', group: '小组' };
const kinds = {
  post: '帖子',
  reply: '回复草稿',
  comment: '评论草稿',
  reel: 'Reel',
  story: '快拍',
  live: '直播提纲',
};
const states = {
  draft: '草稿',
  approved: '已审核',
  scheduled: '已排期',
  published: '已登记发布',
  observed: '待研判',
  inquiry: '已询盘',
  handed_off: '已交接',
  quoted: '已报价',
  won: '已成交',
  weak: '一般信号',
  strong: '强信号',
  candidate: '待验证',
  proposed: '待验证',
  pending: '待审核',
  accepted: '已采纳',
  active: '使用中',
  retired: '已停用',
  rejected: '已否决',
  researching: '观察中',
  organic: '自然流量',
  paid: '付费流量',
  unknown: '来源待核实',
  own: '自有小组',
  third_party: '第三方小组',
};
const authStages = {
  observed: '待研判',
  inquiry: '已询盘',
  handed_off: '已交接',
  quoted: '已报价',
  won: '已成交',
};
const stages = Object.keys(authStages);
const idOptions = (rows, label, empty) => [
  ['', empty],
  ...rows.map((item) => [item.id, label(item).slice(0, 90)]),
];
export const tr = (value) =>
  states[value] || surfaces[value] || kinds[value] || value || '—';
export function Pill({ value }) {
  const variant = [
    'approved',
    'published',
    'accepted',
    'active',
    'won',
    'handed_off',
    'strong',
  ].includes(value)
    ? 'success'
    : ['draft', 'pending', 'candidate', 'scheduled', 'inquiry'].includes(value)
      ? 'warning'
      : 'neutral';
  return <Badge variant={variant} label={tr(value)} />;
}
export function Block({ title, icon, side, children }) {
  return (
    <section className="section">
      <div className="section-heading">
        <div className="section-title">
          {icon && <Icon name={icon} />}
          <h2>{title}</h2>
        </div>
        {side}
      </div>
      {children}
    </section>
  );
}
export function F(name, label, extra = {}) {
  return { name, label, ...extra };
}
export function Form({
  title,
  fields,
  initial = {},
  onSave,
  onCancel,
  submit = '保存',
  note,
  busy,
}) {
  const [values, setValues] = useState(() => {
    const vals = {};
    for (const spec of fields) {
      let value = initial[spec.name] ?? spec.defaultValue ?? '';
      if (Array.isArray(value)) value = value.join(', ');
      if (spec.type === 'datetime-local' && value) {
        const d = new Date(value);
        if (Number.isFinite(+d))
          value = new Date(+d - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
      }
      vals[spec.name] = value;
    }
    return vals;
  });
  const show = (field) => !field.when || field.when(values);
  async function save(e) {
    e.preventDefault();
    const out = {};
    for (const field of fields.filter(show)) {
      const value = String(values[field.name] ?? '').trim();
      out[field.name] =
        field.type === 'datetime-local' && value
          ? new Date(value).toISOString()
          : value;
    }
    await onSave(out);
  }
  return (
    <form className="editor" onSubmit={save}>
      <div className="section-heading">
        <h2>{title}</h2>
        {onCancel && (
          <Button small onClick={onCancel} disabled={busy}>
            关闭
          </Button>
        )}
      </div>
      {note && <p className="note">{note}</p>}
      <div className="fields">
        {fields.filter(show).map((field) => (
          <Field
            {...field}
            key={field.name}
            value={values[field.name]}
            onChange={(name, value) => setValues({ ...values, [name]: value })}
            disabled={busy}
          />
        ))}
      </div>
      <div className="actions">
        <Button type="submit" primary disabled={busy}>
          {submit}
        </Button>
      </div>
    </form>
  );
}
const multi = { wide: true, type: 'textarea' };
const url = { type: 'url' };
const groupFields = [
  F('name', '小组名称', { required: true }),
  F('url', 'Facebook 小组主页', {
    ...url,
    required: true,
    placeholder: 'https://www.facebook.com/groups/…',
  }),
  F('kind', '管理关系', {
    options: choices({ third_party: '第三方小组', own: '自有小组' }),
    defaultValue: 'third_party',
  }),
  F('status', '运营状态', {
    defaultValue: 'researching',
    placeholder: '例如：观察中、定期参与',
  }),
  F('rules', '组规与允许参与的方式', {
    ...multi,
    placeholder: '注明发帖限制、推广日、管理员要求及核对日期。',
  }),
];
const profileFields = [
  F('name', '账号显示名称', { required: true }),
  F('industry', '行业'),
  F('audience', '目标受众'),
  F('offer', '产品或服务'),
  F('market', '目标市场'),
  F('language', '内容语言'),
  F('identity', '发帖身份'),
  F('pageId', 'Facebook 公共主页 ID', { placeholder: '数字 ID' }),
  F('graphVersion', 'Graph API 版本', {
    placeholder: '填写应用实际使用的 API 版本',
  }),
  F('pageAuthorized', '账号授权状态', {
    options: [
      ['false', '尚未授权主页操作'],
      ['true', '已获此公共主页操作授权'],
    ],
    defaultValue: 'false',
  }),
  F('voice', '品牌语气'),
  F('goal', '运营目标'),
  F('salesUrl', '本地销售工作台地址', {
    ...url,
    placeholder: 'http://127.0.0.1:端口',
  }),
  F('salesProfileName', '销售工作台业务名称', {
    hint: '填写销售工作台档案中的完整名称。',
  }),
];
function contentFields(s) {
  return [
    F('title', '内部标题', { wide: true }),
    F('surface', '使用位置', {
      options: choices(surfaces),
      defaultValue: 'page',
    }),
    F('kind', '内容形式', { options: choices(kinds), defaultValue: 'post' }),
    F('groupId', '对应小组', {
      options: idOptions(s.groups, (x) => x.name, '选择小组'),
      when: (v) => v.surface === 'group',
    }),
    F('identity', '发帖身份', {
      defaultValue: s.profile.identity || s.profile.name || '',
    }),
    F('assetRights', '素材权属或授权说明'),
    F('pageId', '绑定公共主页 ID', {
      defaultValue: s.profile.pageId || '',
      when: (v) => v.surface === 'page',
    }),
    F('targetId', '回复目标评论 ID', {
      when: (v) => v.surface === 'page' && v.kind === 'reply',
    }),
    F('postId', '回复所在帖子 ID', {
      when: (v) => v.surface === 'page' && v.kind === 'reply',
    }),
    F('intent', '内容目的'),
    F('sourceInteractionId', '来源互动', {
      options: idOptions(s.interactions, (x) => x.text, '手动选题'),
    }),
    F('body', '正文', {
      ...multi,
      required: true,
      placeholder: '写下读者遇到的问题、具体建议及下一步。',
    }),
  ];
}
function interactionFields(s) {
  return [
    F('text', '互动原文', { ...multi, required: true }),
    F('sourceUrl', '来源链接', url),
    F('channel', '渠道', {
      options: choices({
        comment: '评论',
        messenger: 'Messenger',
        group: '小组讨论',
        other: '其他',
      }),
      defaultValue: 'comment',
    }),
    F('direction', '方向', {
      options: choices({
        inbound: '客户主动',
        observation: '公开观察',
        outbound: '我方发起',
      }),
      defaultValue: 'inbound',
    }),
    F('origin', '归因', {
      options: choices({
        unknown: '来源待核实',
        organic: '自然流量',
        paid: '付费流量',
      }),
      defaultValue: 'unknown',
    }),
    F('category', '问题或意图', {
      options: choices({
        observation: '一般观察',
        question: '产品问题',
        inquiry: '采购询盘',
        quote_request: '询价',
        sample_request: '索样',
        objection: '顾虑或异议',
        feedback: '反馈',
        complaint: '投诉',
      }),
      defaultValue: 'observation',
    }),
    F('signal', '信号强度', {
      options: choices({ weak: '一般信号', strong: '强信号' }),
      defaultValue: 'weak',
    }),
    F('externalId', '原始消息或评论 ID', { hint: '交接销售时需填写。' }),
    F('contactPermission', '联系许可', {
      options: choices({
        unknown: '待确认',
        requested: '对方主动要求联系',
        consented: '已取得同意',
        opted_out: '对方已退订',
      }),
      defaultValue: 'unknown',
    }),
    F('evidence', '判断依据', {
      ...multi,
      placeholder: '例如：客户在原文中给出了数量、项目期限或预算。',
    }),
    F('companyName', '客户或公司名称'),
    F('companyKey', '客户唯一标识', {
      hint: '同一客户使用相同标识，便于按公司归因。',
    }),
    F('contentId', '关联内容', {
      options: idOptions(s.content, (x) => x.title || x.body, '无关联内容'),
    }),
    F('stage', '销售阶段', {
      options: choices(authStages),
      defaultValue: 'observed',
    }),
    F('nextAction', '下次跟进'),
    F('followupAt', '跟进时间', { type: 'datetime-local' }),
    F('outcomeEvidence', '阶段变化凭据', { ...multi }),
    F('salesReceipt', '销售回执编号', {
      when: (v) => stages.indexOf(v.stage) >= 2,
    }),
  ];
}
function learningFields(s) {
  return [
    F('title', '方法名称', { required: true, wide: true }),
    F('scope', '适用条件', { required: true }),
    F('evidence', '证据记录 ID', {
      required: true,
      placeholder: '多条证据以逗号分隔',
      hint: '下方列出本账号可选择的内容和互动记录。',
    }),
    F('method', '具体做法', { ...multi, required: true }),
  ];
}

export function SafeLink({ value, children }) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  return ['https:', 'http:'].includes(u.protocol) &&
    !u.username &&
    !u.password ? (
    <a href={u.href} target="_blank" rel="noopener noreferrer">
      {children || '查看来源'}
    </a>
  ) : null;
}
const dt = (v) =>
  v && Number.isFinite(Date.parse(v))
    ? new Date(v).toLocaleString('zh-CN', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '';
export function RecordTitle({ row, type }) {
  return type === 'content'
    ? row.title || '未命名草稿'
    : type === 'interaction'
      ? row.companyName || row.category || '互动记录'
      : row.title || row.name || '记录';
}
function Record({ row, type, open }) {
  const stamp = dt(row.updatedAt || row.createdAt);
  let meta = [],
    body = '',
    status = row.status;
  if (type === 'content') {
    body = row.body;
    meta = [
      tr(row.surface),
      tr(row.kind),
      row.scheduledAt && '排期 ' + dt(row.scheduledAt),
    ];
  }
  if (type === 'interaction') {
    body = row.text;
    status = row.stage;
    meta = [
      tr(row.signal),
      tr(row.origin),
      row.nextAction,
      row.followupAt && dt(row.followupAt),
    ];
  }
  if (type === 'group') {
    body = row.rules;
    meta = [tr(row.kind)];
  }
  if (type === 'learning') {
    body = row.method;
    meta = [row.scope, Array.isArray(row.evidence) && row.evidence.join(' · ')];
  }
  return (
    <article className="record">
      <div className="record-flex">
        <h3>
          <RecordTitle row={row} type={type} />
        </h3>
        <Pill value={status} />
      </div>
      {body && <p>{body}</p>}
      <div className="record-meta">
        {meta.filter(Boolean).map((v, i) => (
          <span key={i}>{v}</span>
        ))}
        <span>{stamp}</span>
        <code>{row.id}</code>
        <SafeLink value={row.permalink || row.sourceUrl || row.url} />
      </div>
      <div className="actions">
        {(type !== 'content' || row.status !== 'published') &&
          type !== 'learning' && (
            <Button small onClick={() => open('edit', row)}>
              编辑
            </Button>
          )}
        {type === 'content' && row.status === 'draft' && (
          <Button small onClick={() => open('approve', row)}>
            审核草稿
          </Button>
        )}
        {type === 'content' &&
          ['approved', 'scheduled'].includes(row.status) && (
            <>
              <Button small onClick={() => open('schedule', row)}>
                设置排期
              </Button>
              <Button small onClick={() => open('receipt', row)}>
                登记发布回执
              </Button>
            </>
          )}
        {type === 'interaction' &&
          row.direction === 'inbound' &&
          row.contactPermission !== 'opted_out' &&
          (row.stage === 'inquiry' ||
            ['inquiry', 'quote_request', 'sample_request'].includes(
              row.category,
            )) &&
          !row.salesReceipt && (
            <Button small onClick={() => open('handoff', row)}>
              交接销售
            </Button>
          )}
        {type === 'interaction' && row.salesReceipt && (
          <Button small onClick={() => open('sync', row)}>
            同步销售进度
          </Button>
        )}
        {type === 'learning' &&
          !['retired', 'rejected'].includes(row.status) && (
            <Button small onClick={() => open('review', row)}>
              复核方法
            </Button>
          )}
      </div>
    </article>
  );
}
const schema = {
  content: {
    title: '内容',
    plural: '内容记录',
    key: 'content',
    fields: contentFields,
  },
  interaction: {
    title: '互动',
    plural: '互动记录',
    key: 'interactions',
    fields: interactionFields,
  },
  group: {
    title: '小组',
    plural: '小组记录',
    key: 'groups',
    fields: () => groupFields,
  },
  learning: {
    title: '方法',
    plural: '方法记录',
    key: 'learning',
    fields: learningFields,
  },
};
export function Records({ type, s, mode, setMode, busy, mutate }) {
  const [filter, setFilter] = useState('');
  const spec = schema[type],
    rows = s[spec.key],
    row = mode?.row || {};
  const open = (action, item = {}) => {
    setMode({ action, row: item });
    window.scrollTo({ top: 0 });
  };
  const close = () => setMode(null);
  const save = async (action, data) => {
    if (await mutate(action, data)) close();
  };
  const filtered = rows.filter(
    (r) =>
      !filter ||
      [
        r.title,
        r.name,
        r.text,
        r.body,
        r.companyName,
        r.status,
        r.method,
        r.id,
        tr(r.stage),
        tr(r.status),
      ].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(filter.toLowerCase()),
      ),
  );
  const action = mode?.action;
  let editor = null;
  if (action === 'new' || action === 'edit') {
    const initial = { ...row };
    if (type === 'interaction' && typeof initial.salesReceipt === 'object')
      delete initial.salesReceipt;
    editor = (
      <Form
        key={action + (row.id || 'new')}
        title={(action === 'new' ? '新建' : '编辑') + spec.title}
        fields={spec.fields(s)}
        initial={initial}
        busy={busy}
        onCancel={close}
        submit={type === 'content' ? '保存草稿' : '保存' + spec.title}
        onSave={(v) => {
          if (type === 'learning')
            v.evidence = v.evidence
              .split(/[,，\n]/)
              .map((x) => x.trim())
              .filter(Boolean);
          if (type === 'content') {
            v.status = 'draft';
            if (v.surface !== 'group') v.groupId = '';
          }
          return save(type, { ...v, ...(row.id ? { id: row.id } : {}) });
        }}
      />
    );
  } else if (action === 'approve') {
    editor = (
      <Form
        key={'approve' + row.id}
        title="审核草稿"
        note={row.body}
        fields={[]}
        onCancel={close}
        busy={busy}
        submit="确认审核通过"
        onSave={() => save('content', { id: row.id, status: 'approved' })}
      />
    );
  } else if (action === 'schedule') {
    editor = (
      <Form
        key={'schedule' + row.id}
        title="设置排期"
        note={
          '《' +
          row.title +
          '》将按本机时区登记。单独启用本账号派发器后，符合条件的公共主页纯文字帖子可在到期时发布。其他内容按计划人工处理。'
        }
        fields={[
          F('scheduledAt', '计划时间', {
            required: true,
            type: 'datetime-local',
          }),
        ]}
        initial={row}
        onCancel={close}
        busy={busy}
        submit="保存排期"
        onSave={(v) =>
          save('content', { id: row.id, status: 'scheduled', ...v })
        }
      />
    );
  } else if (action === 'receipt') {
    editor = (
      <Form
        key={'receipt' + row.id}
        title="登记已发布内容"
        note="在 Facebook 完成发布后，把实际回执登记在这里。"
        fields={[
          F('permalink', 'Facebook 永久链接', { ...url, required: true }),
          F('remoteId', '平台内容 ID', { required: true }),
        ]}
        onCancel={close}
        busy={busy}
        submit="保存发布回执"
        onSave={(v) =>
          save('content', { id: row.id, status: 'published', ...v })
        }
      />
    );
  } else if (action === 'review') {
    const decisions = ['active', 'accepted'].includes(row.status)
      ? { retire: '停用' }
      : { accept: '采纳', reject: '否决' };
    editor = (
      <Form
        key={'review' + row.id}
        title="复核方法"
        note={row.method}
        fields={[
          F('decision', '复核结果', {
            options: choices(decisions),
            defaultValue: Object.keys(decisions)[0],
          }),
        ]}
        onCancel={close}
        busy={busy}
        submit="确认复核"
        onSave={(v) => save('review', { id: row.id, ...v })}
      />
    );
  } else if (action === 'handoff' || action === 'sync') {
    const handoff = action === 'handoff';
    editor = (
      <Form
        key={action + row.id}
        title={handoff ? '交接到销售工作台' : '同步销售进度'}
        note={
          handoff
            ? '将此互动提交至本账号配置的本地销售工作台，并保存返回的回执。'
            : '从已交接的本地销售记录读取最新阶段。'
        }
        fields={[]}
        onCancel={close}
        busy={busy}
        submit={handoff ? '确认交接此互动' : '读取销售进度'}
        onSave={() =>
          save(handoff ? 'sales-handoff' : 'sales-sync', { id: row.id })
        }
      />
    );
  }
  return (
    <>
      {editor}
      {type === 'learning' && action === 'new' && <Evidence s={s} />}
      <Block title={spec.plural} side={<small>共 {rows.length} 条</small>}>
        <div className="toolbar">
          <input
            className="search"
            aria-label={'筛选' + spec.title}
            placeholder={'按名称、状态或 ID 筛选'}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button small onClick={() => open('new')}>
            <Icon name="plus" size={14} />
            新建{spec.title}
          </Button>
        </div>
        {filtered.length ? (
          [...filtered]
            .reverse()
            .map((item) => (
              <Record key={item.id} row={item} type={type} open={open} />
            ))
        ) : (
          <Empty>
            {filter
              ? '没有匹配记录，可调整筛选条件。'
              : '本账号暂无' + spec.plural + '。'}
          </Empty>
        )}
      </Block>
    </>
  );
}
function Evidence({ s }) {
  const rows = [
    ...s.content.map((r) => [r.id, r.title]),
    ...s.interactions.map((r) => [r.id, r.text]),
  ];
  return (
    <Block title="可引用的证据">
      <div className="list-stack">
        {rows.length ? (
          rows.map(([id, label]) => (
            <div className="muted wrap" key={id}>
              <code>{id}</code> · {label}
            </div>
          ))
        ) : (
          <p className="muted">先登记本账号的内容或互动。</p>
        )}
      </div>
    </Block>
  );
}
export function ProfileForm({ s, busy, mutate }) {
  const [check, setCheck] = useState(null);
  return (
    <>
      <Form
        key={s.profile.updatedAt || s.tenant}
        title="账号运营档案"
        fields={profileFields}
        initial={{
          ...s.profile,
          pageAuthorized: String(s.profile.pageAuthorized === true),
        }}
        submit="保存账号档案"
        busy={busy}
        onSave={(v) =>
          mutate('profile', {
            ...v,
            pageAuthorized: v.pageAuthorized === 'true',
          })
        }
      />
      <Block title="Meta 公共主页连接" icon="profile">
        <p className="muted">检测本机配置的账号凭据与公共主页权限。</p>
        <div className="quick-row">
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await mutate('meta-check', {});
              if (r) setCheck(r);
            }}
          >
            检查连接
          </Button>
        </div>
        {check && (
          <pre className="note wrap">{JSON.stringify(check, null, 2)}</pre>
        )}
      </Block>
    </>
  );
}
