// CrayfishLoading component

const CrayfishLoading = () => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: 400, gap: 24,
  }}>
    <div style={{
      fontSize: 14, fontFamily: 'monospace', color: '#2563eb',
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
        fontSize: 14, fontWeight: 700, color: '#1e293b',
        animation: 'text-pulse 2s infinite'
      }}>
        OpenClaw 状态监测中
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>
        正在同步网关核心数据，请稍后...
      </div>
    </div>
  </div>
);

export default CrayfishLoading;
