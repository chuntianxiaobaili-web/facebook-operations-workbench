import React, { useId } from 'react';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  action: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 'var(--radius-element, 10px)',
    borderWidth: 1,
    borderStyle: 'solid',
    fontWeight: 650,
    minHeight: 39,
    paddingInline: 14,
    paddingBlock: 7,
    fontSize: 14,
  },
  primary: {
    color: 'var(--color-on-accent, #fff)',
    backgroundColor: { default: 'var(--color-accent, #1b1b1b)', ':hover': 'var(--color-text-secondary, #474747)' },
    borderColor: 'var(--color-accent, #1b1b1b)',
  },
  secondary: {
    color: 'var(--color-text-primary, #1b1b1b)',
    backgroundColor: { default: 'var(--color-background-surface, #fff)', ':hover': 'var(--color-background-muted, #f1f1f1)' },
    borderColor: 'var(--color-border-emphasized, #d4d4d4)',
  },
  small: { minHeight: 31, fontSize: 12, paddingInline: 10, paddingBlock: 4 },
});

export function Button({ primary, small, type = 'button', children, ...rest }) {
  return (
    <button
      {...stylex.props(
        styles.action,
        primary ? styles.primary : styles.secondary,
        small && styles.small,
      )}
      type={type}
      {...rest}
    >
      {children}
    </button>
  );
}

const paths = {
  dashboard: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  content: ['M5 3h11l3 3v15H5z', 'M8 10h8', 'M8 14h8', 'M8 18h5'],
  interactions: ['M3 4h14v10H8l-4 4v-4H3z', 'M19 9h2v10h-2v2l-3-2h-5'],
  groups: [
    'M3 20v-2c0-3 2-5 5-5s5 2 5 5v2',
    'M15 14c3 0 5 2 5 5',
    'M11 7a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
    'M15 4a3 3 0 1 1 0 6',
  ],
  learning: [
    'M3 4c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1z',
    'M12 5v15',
  ],
  report: ['M4 3v17h17', 'M8 16v-5', 'M13 16V7', 'M18 16V4'],
  profile: ['M3 21c0-5 4-8 9-8s9 3 9 8', 'M16 7a4 4 0 1 1-8 0 4 4 0 1 1 8 0'],
  plus: ['M12 5v14', 'M5 12h14'],
  next: ['m9 6 6 6-6 6'],
  layers: ['m3 8 9-5 9 5-9 5z', 'm3 12 9 5 9-5', 'm3 16 9 5 9-5'],
  down: ['m6 9 6 6 6-6'],
  check: ['m5 12 4 4L19 6'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0', 'M12 7v5l3 2'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  close: ['m5 5 14 14', 'm19 5-14 14'],
  tray: ['M4 6h16l2 11v2H2v-2z', 'M3 14h5l2 2h4l2-2h5'],
};
export function Icon({ name, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {(paths[name] || []).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function Field({
  name,
  label,
  value,
  onChange,
  options,
  type = 'text',
  required,
  placeholder,
  hint,
  wide,
  disabled,
}) {
  const id = useId();
  const props = {
    id,
    name,
    value: value ?? '',
    required,
    disabled,
    placeholder,
    'aria-describedby': hint ? id + '-hint' : undefined,
    onChange: (event) => onChange(name, event.target.value),
  };
  return (
    <div className={'field' + (wide ? ' wide' : '')}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {options ? (
        <select {...props}>
          {value && !options.some(([v]) => v === value) && (
            <option value={value}>{value}</option>
          )}
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea {...props} rows={3} />
      ) : (
        <input {...props} type={type} />
      )}
      {hint && <small id={id + '-hint'}>{hint}</small>}
    </div>
  );
}
export function Empty({ children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="tray" size={22} />
      </span>
      <p>{children}</p>
      {action}
    </div>
  );
}
