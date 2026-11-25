import React from 'react';

interface AppLogoProps {
  size?: number;
  className?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({ size = 20, className = '' }) => (
  <img src="./oneterm-icon.png" alt="" width={size} height={size} className={`shrink-0 ${className}`} />
);
