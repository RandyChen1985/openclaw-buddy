// CrayfishLoading component

interface CrayfishLoadingProps {
  isDarkMode?: boolean;
}

const CrayfishLoading = ({ isDarkMode = false }: CrayfishLoadingProps) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100vh', width: '100%', gap: 24,
    background: isDarkMode ? '#0f172a' : '#f8fafc'
  }}>
    <div style={{
      fontSize: 14, fontFamily: 'monospace', color: isDarkMode ? '#93c5fd' : '#2563eb',
      lineHeight: 1.2, whiteSpace: 'pre', textAlign: 'center',
      animation: 'crayfish-bounce 2s ease-in-out infinite',
    }}>
{`      _   _
     / \\_/ \\
    (  o o  )
     \\  ^  /
      \\___/
      /   \\
     /     \\
    (       )
     \\_____/
      | | |`}
    </div>
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8
    }}>
      <div style={{
        fontSize: 14, fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#1e293b',
        animation: 'text-pulse 2s infinite'
      }}>
        OpenClaw 状态监测中
      </div>
      <div style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#94a3b8' }}>
        正在同步网关核心数据，请稍后...
      </div>
    </div>
  </div>
);

export default CrayfishLoading;
