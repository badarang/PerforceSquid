export function SquidIcon({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 256 256" 
      className={className}
    >
      <path fill="#3498db" d="M 128,40 C 90,40 64,70 64,100 S 90,160 128,160 S 192,130 192,100 S 166,40 128,40 Z"/>
      <circle cx="104" cy="90" r="12" fill="white"/>
      <circle cx="152" cy="90" r="12" fill="white"/>
      <circle cx="104" cy="90" r="6" fill="black"/>
      <circle cx="152" cy="90" r="6" fill="black"/>
      <path fill="none" stroke="#3498db" strokeWidth="12" strokeLinecap="round" d="M 88,160 Q 80,190 88,220"/>
      <path fill="none" stroke="#3498db" strokeWidth="12" strokeLinecap="round" d="M 112,160 Q 108,195 118,220"/>
      <path fill="none" stroke="#3498db" strokeWidth="12" strokeLinecap="round" d="M 144,160 Q 148,195 138,220"/>
      <path fill="none" stroke="#3498db" strokeWidth="12" strokeLinecap="round" d="M 168,160 Q 176,190 168,220"/>
    </svg>
  )
}
