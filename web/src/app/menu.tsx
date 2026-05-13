import { Badge } from 'antd';
import {
  Activity,
  Boxes,
  Clock,
  ExternalLink,
  LayoutDashboard,
  MessageSquare,
  Puzzle,
  Rocket,
  Settings,
  ShieldCheck,
  Smartphone,
  Terminal,
  ToyBrick,
  Users,
  Zap,
} from 'lucide-react';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export type AuthMe = {
  is_superadmin: boolean;
  permissions: string[];
};

export const menuPermissionMap: Record<string, string> = {
  dashboard: 'menu:monitor:dashboard:view',
  audit: 'menu:monitor:audit:view',
  logs: 'menu:monitor:logs:view',
  tools: 'menu:monitor:self_healing:manage',
  shell: 'menu:monitor:shell:manage',
  security: 'menu:monitor:security:manage',
  cron: 'menu:monitor:cron:view',
  chat: 'menu:assets:chat:view',
  tui: 'menu:assets:tui:view',
  'bots-models': 'menu:assets:bots:manage',
  skills: 'menu:assets:skills:manage',
  plugins: 'menu:assets:plugins:manage',
  experts: 'menu:assets:experts:view',
  components: 'menu:binding:channels:manage',
  devices: 'menu:binding:devices:manage',
  'system.users': 'menu:system:user:manage',
  'lobster-panel': 'menu:external:lobster_panel:open',
};

export function hasMenuPermission(authMe: AuthMe, key: string): boolean {
  const need = menuPermissionMap[key];
  if (!need) return true;
  if (authMe.is_superadmin) return true;
  return authMe.permissions.includes(need);
}

export function createMenuItems(params: {
  t: TranslateFn;
  wsLogCount: number;
  healEventCount: number;
  disabledFeatures: string[];
  showExternalTools?: boolean;
  authMe: AuthMe;
}) {
  const { t, wsLogCount, healEventCount, disabledFeatures, showExternalTools, authMe } = params;

  const rawMenuItems = [
    {
      key: 'grp-monitor',
      label: t('common.monitor'),
      icon: <Activity size={16} />,
      children: [
        { key: 'dashboard', label: t('common.dashboard'), icon: <LayoutDashboard size={14} /> },
        { key: 'audit', label: t('audit.title'), icon: <ShieldCheck size={14} /> },
        {
          key: 'logs',
          label: (
            <span>
              {t('common.logs')}
              {wsLogCount > 0 && <Badge status="processing" size="small" style={{ marginLeft: 8 }} />}
            </span>
          ),
          title: t('common.logs'),
          icon: <Terminal size={14} />,
        },
        {
          key: 'tools',
          label: (
            <span>
              {t('common.tools')}
              {healEventCount > 0 && (
                <Badge
                  count={healEventCount}
                  size="small"
                  style={{ marginLeft: 8, backgroundColor: '#3b82f6' }}
                />
              )}
            </span>
          ),
          title: t('common.tools'),
          icon: <Zap size={14} />,
        },
        { key: 'shell', label: t('common.shell'), icon: <Terminal size={14} /> },
        { key: 'security', label: t('security.title'), icon: <ShieldCheck size={14} /> },
        { key: 'cron', label: t('common.cron'), icon: <Clock size={14} /> },
      ],
    },
    {
      key: 'grp-assets',
      label: t('common.assets'),
      icon: <Boxes size={16} />,
      children: [
        { key: 'chat', label: t('common.chat'), icon: <MessageSquare size={14} /> },
        { key: 'tui', label: t('common.tuiChat'), icon: <Terminal size={14} /> },
        { key: 'bots-models', label: t('common.bots'), icon: <Boxes size={14} /> },
        { key: 'skills', label: t('common.skills'), icon: <Puzzle size={14} /> },
        { key: 'plugins', label: t('plugins.title'), icon: <Zap size={14} /> },
        { key: 'experts', label: t('common.expertMarket'), icon: <Rocket size={14} /> },
      ],
    },
    {
      key: 'grp-binding',
      label: t('common.binding'),
      icon: <ToyBrick size={16} />,
      children: [
        { key: 'components', label: t('common.channels'), icon: <ToyBrick size={14} /> },
        { key: 'devices', label: t('common.devices'), icon: <Smartphone size={14} /> },
      ],
    },
    {
      key: 'grp-system',
      label: t('common.systemAdmin'),
      icon: <Settings size={16} />,
      children: [
        { key: 'system.users', label: t('common.userManagement'), icon: <Users size={14} /> },
      ],
    },
    {
      key: 'grp-external',
      label: t('common.external'),
      icon: <ExternalLink size={16} />,
      children: [
        { key: 'lobster-panel', label: t('common.lobsterPanel'), icon: <ExternalLink size={14} /> },
      ],
    },
  ];

  return rawMenuItems
    .filter(group => group.key !== 'grp-external' || !!showExternalTools)
    .map(group => ({
      ...group,
      children: group.children?.filter(item => {
        if (item.key === 'chat') return true;
        if (disabledFeatures.includes(item.key)) return false;
        return hasMenuPermission(authMe, item.key);
      }),
    }))
    .filter(group => group.children && group.children.length > 0);
}

export function getActiveMenuLabel(menuItems: ReturnType<typeof createMenuItems>, key: string, t: TranslateFn): string {
  for (const group of menuItems) {
    const item = group.children?.find(i => i.key === key);
    if (item) {
      if (typeof item.label === 'string') return item.label;
      if (item.key === 'logs') return t('common.logs');
      if (item.key === 'tools') return t('common.tools');
      return key;
    }
  }
  return '';
}
