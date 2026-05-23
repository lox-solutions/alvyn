import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { VersionSwitcher } from '@/components/version-switcher';
import { appName, basePath, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${basePath}/logo.png`}
            alt={`${appName} logo`}
            width={28}
            height={28}
            className="rounded-md"
          />
          <span className="font-semibold">{appName}</span>
        </>
      ),
    },
    links: [
      {
        type: 'custom',
        children: <VersionSwitcher />,
        secondary: true,
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
