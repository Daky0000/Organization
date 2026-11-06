import React from 'react';

/** Official brand SVG logos for each social platform. */
function FacebookLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#1877F2" />
      <g transform="translate(8,8)">
        <path fill="white" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
      </g>
    </svg>
  );
}

function InstagramLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="5%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill="url(#ig-grad)" />
      <rect x="12" y="12" width="16" height="16" rx="5" stroke="white" strokeWidth="1.8" fill="none" />
      <circle cx="20" cy="20" r="4" stroke="white" strokeWidth="1.8" fill="none" />
      <circle cx="25.2" cy="14.8" r="1.1" fill="white" />
    </svg>
  );
}

function LinkedInLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#0A66C2" />
      <g transform="translate(8,8)">
        <path fill="white" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </g>
    </svg>
  );
}

function XLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#000000" />
      <g transform="translate(8,8)">
        <path fill="white" d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" />
      </g>
    </svg>
  );
}

function PinterestLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#E60023" />
      <g transform="translate(8,8)">
        <path fill="white" d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z" />
      </g>
    </svg>
  );
}

function ThreadsLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#000000" />
      <g transform="translate(8,8)">
        <path fill="white" d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z" />
      </g>
    </svg>
  );
}

function WordPressLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#21759B" />
      <g transform="translate(8,8)">
        <path fill="white" d="M21.469 6.825c.84 1.537 1.318 3.3 1.318 5.175 0 3.979-2.156 7.456-5.363 9.325l3.295-9.527c.615-1.54.82-2.771.82-3.864 0-.405-.026-.78-.07-1.11m-7.981.105c.647-.03 1.232-.105 1.232-.105.582-.075.514-.93-.067-.899 0 0-1.755.135-2.88.135-1.064 0-2.85-.15-2.85-.15-.585-.03-.661.855-.075.885 0 0 .54.061 1.125.09l1.68 4.605-2.37 7.08L5.354 6.9c.649-.03 1.234-.1 1.234-.1.585-.075.516-.93-.065-.896 0 0-1.746.138-2.874.138-.2 0-.438-.008-.69-.015C4.911 3.15 8.235 1.215 12 1.215c2.809 0 5.365 1.072 7.286 2.833-.046-.003-.091-.009-.141-.009-1.06 0-1.812.923-1.812 1.914 0 .89.513 1.643 1.06 2.531.411.72.89 1.643.89 2.977 0 .915-.354 1.994-.821 3.479l-1.075 3.585-3.9-11.61.001.014zM12 22.784c-1.059 0-2.081-.153-3.048-.437l3.237-9.406 3.315 9.087c.024.053.05.101.078.149-1.12.393-2.325.609-3.582.609M1.211 12c0-1.564.336-3.05.935-4.39L7.29 21.709C3.694 19.96 1.212 16.271 1.211 12M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0" />
      </g>
    </svg>
  );
}

function TikTokLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#010101" />
      <g transform="translate(8,8)">
        <path fill="white" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
      </g>
    </svg>
  );
}

function YouTubeLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#FF0000" />
      <g transform="translate(8,8)">
        <path fill="white" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </g>
    </svg>
  );
}

function PaystackLogo({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#011b33" />{[0,1,2,3].map(i => <rect key={i} x="9" y={10+i*6} width={22-i*3} height="3" rx="1.5" fill="#00c3f7" />)}</svg>;
}

function MailchimpLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#FFE01B" />
      {/* Freddie the Chimp — Mailchimp mascot icon */}
      <g transform="translate(8,8)">
        <path fill="#241C15" d="M11.267 0C6.791-.015-1.82 10.246 1.397 12.964l.79.669a3.88 3.88 0 0 0-.22 1.792c.084.84.518 1.644 1.22 2.266.666.59 1.542.964 2.392.964 1.406 3.24 4.62 5.228 8.386 5.34 4.04.12 7.433-1.776 8.854-5.182.093-.24.488-1.316.488-2.267 0-.956-.54-1.352-.885-1.352-.01-.037-.078-.286-.172-.586-.093-.3-.19-.51-.19-.51.375-.563.382-1.065.332-1.35-.053-.353-.2-.653-.496-.964-.296-.311-.902-.63-1.753-.868l-.446-.124c-.002-.019-.024-1.053-.043-1.497-.014-.32-.042-.822-.197-1.315-.186-.668-.508-1.253-.911-1.627 1.112-1.152 1.806-2.422 1.804-3.511-.003-2.095-2.576-2.729-5.746-1.416l-.672.285A678.22 678.22 0 0 0 12.7.504C12.304.159 11.817.002 11.267 0zm.073.873c.166 0 .322.019.465.058.297.084 1.28 1.224 1.28 1.224s-1.826 1.013-3.52 2.426c-2.28 1.757-4.005 4.311-5.037 7.082-.811.158-1.526.618-1.963 1.253-.261-.218-.748-.64-.834-.804-.698-1.326.761-3.902 1.781-5.357C5.834 3.44 9.37.867 11.34.873z" />
      </g>
    </svg>
  );
}

function HubtelLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#00539B" />
      <rect x="10" y="15" width="20" height="12" rx="2" fill="none" stroke="white" strokeWidth="1.6" />
      <rect x="10" y="19" width="20" height="3" fill="white" />
      <rect x="12.5" y="24" width="5" height="1.8" rx="0.6" fill="white" />
      <rect x="19" y="24" width="3" height="1.8" rx="0.6" fill="white" />
    </svg>
  );
}

function GmailLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="10" fill="#ffffff" />
      <rect x="6" y="10" width="28" height="20" rx="2" fill="#EA4335" />
      <path d="M6 12 20 22 34 12" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="6" y="10" width="28" height="20" rx="2" fill="none" stroke="#d93025" strokeWidth="0.5" />
      <path d="M6 12l14 10 14-10V28a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V12z" fill="#EA4335" />
      <path d="M6 12l14 10 14-10" stroke="white" strokeWidth="2" fill="none" />
    </svg>
  );
}

function SlackLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="10" fill="#4A154B" />
      <g transform="translate(8,8)">
        <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.52H2.52A2.528 2.528 0 0 1 0 15.165a2.528 2.528 0 0 1 2.52-2.52h2.522v2.52zM6.313 15.165a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" />
        <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" />
        <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.528 2.528 0 0 1-2.52-2.521V2.522A2.528 2.528 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" />
        <path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.528 2.528 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.528 2.528 0 0 1-2.52-2.523 2.528 2.528 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
      </g>
    </svg>
  );
}

function ZoomLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="10" fill="#2D8CFF" />
      <path d="M6 14a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V14z" fill="white" />
      <path d="M26 17.5l7-4.5v14l-7-4.5V17.5z" fill="white" />
    </svg>
  );
}

function WhatsAppLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="10" fill="#25d366" />
      <path d="M20 6C12.27 6 6 12.27 6 20c0 2.42.65 4.68 1.77 6.63L6 34l7.54-1.74A13.93 13.93 0 0 0 20 34c7.73 0 14-6.27 14-14S27.73 6 20 6zm7.13 19.74c-.33.93-1.87 1.74-2.63 1.85-.68.1-1.54.14-2.48-.16-.57-.18-1.3-.42-2.24-.82-3.93-1.7-6.5-5.65-6.69-5.91-.19-.26-1.6-2.06-1.6-4.06s1.01-2.88 1.37-3.27c.35-.39.77-.49 1.03-.49h.75c.24.01.56-.1.88.67.33.78 1.11 2.72 1.21 2.91.1.19.16.42.03.68-.13.26-.19.43-.39.65-.19.23-.41.51-.58.68-.19.19-.39.4-.17.79.23.39 1.01 1.66 2.16 2.68 1.48 1.32 2.73 1.72 3.12 1.92.39.19.62.16.84-.1.23-.26.97-1.13 1.23-1.52.26-.38.52-.32.88-.19.36.12 2.27 1.06 2.66 1.26.39.19.65.29.74.45.1.15.1.94-.22 1.85z" fill="white" />
    </svg>
  );
}

function GoogleCalendarLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="white" stroke="#e0e0e0" strokeWidth="1" />
      {/* Top bar - Google blue */}
      <rect x="8" y="8" width="24" height="7" rx="2" fill="#1a73e8" />
      {/* Calendar grid area */}
      <rect x="8" y="14" width="24" height="18" rx="0" fill="white" />
      <rect x="8" y="14" width="24" height="18" rx="2" fill="none" stroke="#e0e0e0" strokeWidth="1" />
      {/* Day number "31" in Google blue */}
      <text x="20" y="28" textAnchor="middle" fill="#1a73e8" fontSize="11" fontWeight="bold" fontFamily="sans-serif">31</text>
      {/* Ring hooks */}
      <rect x="14" y="6" width="3" height="6" rx="1.5" fill="#1a73e8" />
      <rect x="23" y="6" width="3" height="6" rx="1.5" fill="#1a73e8" />
    </svg>
  );
}

const LOGOS: Record<string, (size: number) => React.ReactElement> = {
  facebook: (s) => <FacebookLogo size={s} />,
  instagram: (s) => <InstagramLogo size={s} />,
  linkedin: (s) => <LinkedInLogo size={s} />,
  twitter: (s) => <XLogo size={s} />,
  x: (s) => <XLogo size={s} />,
  pinterest: (s) => <PinterestLogo size={s} />,
  threads: (s) => <ThreadsLogo size={s} />,
  wordpress: (s) => <WordPressLogo size={s} />,
  tiktok: (s) => <TikTokLogo size={s} />,
  youtube: (s) => <YouTubeLogo size={s} />,
  paystack: (s) => <PaystackLogo size={s} />,
  mailchimp: (s) => <MailchimpLogo size={s} />,
  hubtel: (s) => <HubtelLogo size={s} />,
  gmail: (s) => <GmailLogo size={s} />,
  google_calendar: (s) => <GoogleCalendarLogo size={s} />,
  slack: (s) => <SlackLogo size={s} />,
  zoom: (s) => <ZoomLogo size={s} />,
  whatsapp: (s) => <WhatsAppLogo size={s} />,
};

/**
 * Returns an official SVG logo for the given platform slug,
 * or a generic lettered circle if no logo is registered.
 */
export function PlatformLogo({ platform, size = 40 }: { platform: string; size?: number }) {
  const slug = platform.toLowerCase().trim();
  const logo = LOGOS[slug];
  if (logo) return logo(size);

  // Generic fallback
  const label = slug.slice(0, 2).toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#64748b" />
      <text x="20" y="25" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="sans-serif">
        {label}
      </text>
    </svg>
  );
}
