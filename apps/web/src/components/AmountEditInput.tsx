import { useState, type CSSProperties } from 'react';
import { formatAmountDisplay, sanitizeAmountInput } from '../utils/amountFormat';

export function AmountEditInput({
  defaultValue,
  onCommit,
  placeholder,
  style,
  className,
}: {
  defaultValue: string;
  onCommit: (raw: string) => void;
  placeholder?: string;
  style?: CSSProperties;
  className?: string;
}) {
  const [raw, setRaw] = useState(defaultValue);
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      style={style}
      className={className}
      value={formatAmountDisplay(raw)}
      onChange={(e) => setRaw(sanitizeAmountInput(e.target.value))}
      onBlur={() => onCommit(raw)}
    />
  );
}
