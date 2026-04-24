import { useEffect, useState } from 'react';

const PHRASES = [
  'phigertottiling',
  'reticulating splines',
  'untangling thoughts',
  'consulting the oracle',
  'polishing prose',
  'gathering electrons',
  'whispering to silicon',
  'aligning dendrites',
  'brewing synapses',
  'summoning tokens',
  'thumbing through pages',
  'parsing the ether',
  'sharpening pencils',
  'percolating ideas',
  'chewing the prompt',
  'tuning antennas',
  'rummaging drawers',
  'untying knots',
  'tracing silk threads',
  'dusting off references',
  'decoding runes',
  'conjuring syllables',
  'calibrating neurons',
  'chasing pigeons',
  'folding napkins',
  'warming up the hamster',
  'greasing the cogs',
  'petting the daemons',
  'counting sheep backwards',
  'misplacing commas',
];

function pickPhrase(previous: string | null): string {
  if (PHRASES.length === 1) return PHRASES[0];
  let next = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  while (next === previous) {
    next = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  }
  return next;
}

export default function ThinkingIndicator() {
  const [phrase, setPhrase] = useState<string>(() => pickPhrase(null));
  const [fadeKey, setFadeKey] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setPhrase((prev) => pickPhrase(prev));
      setFadeKey((k) => k + 1);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="inline-flex items-center gap-2 text-sm leading-[1.5] text-text-tertiary italic">
      <span className="inline-flex items-end gap-0.5 h-3">
        <span className="w-1 h-1 rounded-full bg-text-tertiary animate-thinking-dot" style={{ animationDelay: '0ms' }} />
        <span className="w-1 h-1 rounded-full bg-text-tertiary animate-thinking-dot" style={{ animationDelay: '180ms' }} />
        <span className="w-1 h-1 rounded-full bg-text-tertiary animate-thinking-dot" style={{ animationDelay: '360ms' }} />
      </span>
      <span key={fadeKey} className="animate-thinking-phrase">
        {phrase}…
      </span>
    </span>
  );
}
