window.__ModuleLoader__.load({
  id: 'dsh-session-cycling',
  factory(require) {
    const NS = 'dsh-session-cycling'
    const zh = {
      'meta.title': '会话循环切换',
      'meta.description': '新增四个快捷键命令，让主视图在并行会话之间移动：上一个、下一个、上次使用的、下一个运行中的。',
      'meta.detail': 'docs/DETAIL.md',
      'previous.label': '切换到上一个会话',
      'next.label': '切换到下一个会话',
      'last.label': '切换到上次使用的会话',
      'running.label': '切换到下一个运行中的会话',
    }
    const en = {
      'meta.title': 'Session cycling',
      'meta.description': 'Four commands that move the main view between parallel sessions: previous, next, most recent, and next running.',
      'meta.detail': 'docs/DETAIL.md',
      'previous.label': 'Switch to previous session',
      'next.label': 'Switch to next session',
      'last.label': 'Switch to previously used session',
      'running.label': 'Switch to next running session',
    }

    const mainViewCount = row => (row.retainedBy && row.retainedBy.mainView) || 0

    // Sessions the pointer list also shows: no subagent branches and no untouched drafts.
    const candidates = ctx => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const rows = []
      for (const id of snapshot.ids) {
        const row = snapshot.byId[id]
        if (row === undefined || row.origin === 'subagent' || row.blank === true) continue
        rows.push(row)
      }
      return rows
    }

    const currentIndex = rows => rows.findIndex(row => mainViewCount(row) > 0)

    const open = (ctx, id) => {
      if (typeof id === 'string' && id.length > 0) ctx.uiWorkspace.openSession(id)
    }

    const step = (ctx, delta) => {
      const rows = candidates(ctx)
      if (rows.length < 2) return
      const index = currentIndex(rows)
      const from = index < 0 ? (delta > 0 ? -1 : 0) : index
      const next = (from + delta + rows.length) % rows.length
      open(ctx, rows[next].id)
    }

    const stepRunning = ctx => {
      const rows = candidates(ctx)
      if (rows.length < 2) return
      const index = currentIndex(rows)
      for (let offset = 1; offset <= rows.length; offset += 1) {
        const row = rows[(index + offset + rows.length) % rows.length]
        if (row.running === true && row.id !== (index < 0 ? undefined : rows[index].id)) {
          open(ctx, row.id)
          return
        }
      }
    }

    // Most recent two: remember every distinct main-view session the list shows as current.
    const recent = (ctx, history) => {
      const rows = candidates(ctx)
      if (rows.length < 2) return
      const index = currentIndex(rows)
      if (index < 0) return
      const previous = history.find(id => id !== rows[index].id && rows.some(row => row.id === id))
      open(ctx, previous === undefined ? rows[(index + 1) % rows.length].id : previous)
    }

    return {
      inject: ['locale', 'sessions', 'shortcuts', 'uiWorkspace'],
      apply(ctx) {
        let t = key => key
        try {
          ctx.locale.register(NS, { zh, en })
          t = ctx.locale.bind(NS)
        } catch (error) {
          console.warn('[dsh-session-cycling] locale registration failed', error)
        }

        // Newest first, at most a few entries; the list is rebuilt from live candidates each time.
        const history = []
        try {
          ctx.effect(() => ctx.sessions.list.subscribe(() => {
            const rows = candidates(ctx)
            const row = rows.find(candidate => mainViewCount(candidate) > 0)
            if (row === undefined) return
            const at = history.indexOf(row.id)
            if (at !== -1) history.splice(at, 1)
            history.unshift(row.id)
            if (history.length > 8) history.length = 8
          }), 'dsh-session-cycling: history')
        } catch (error) {
          console.warn('[dsh-session-cycling] history subscription failed', error)
        }

        const register = (id, labelKey, aliases, code, act) => {
          try {
            ctx.effect(() => ctx.shortcuts.register({
              id,
              label: () => t(labelKey),
              aliases,
              // Only shells that accept printable arrows: the registry reserves bare arrows on Linux and Web.
              defaults: {
                'desktop:macos': { code: code, modifiers: ['alt'] },
                'desktop:windows': { code: code, modifiers: ['alt'] },
              },
              regions: ['page', 'editable'],
              modals: ['sidebar'],
              resolve: () => (candidates(ctx).length < 2 ? { status: 'pass' } : { status: 'handled', run: () => act() }),
            }), `dsh-session-cycling: ${id}`)
          } catch (error) {
            console.warn(`[dsh-session-cycling] command ${id} was not registered`, error)
          }
        }

        register('session.cycle.previous', 'previous.label', ['previous session', '上一个会话'], 'ArrowUp', () => step(ctx, -1))
        register('session.cycle.next', 'next.label', ['next session', '下一个会话'], 'ArrowDown', () => step(ctx, 1))
        register('session.cycle.last', 'last.label', ['last session', '上次的会话'], 'ArrowLeft', () => recent(ctx, history))
        register('session.cycle.running', 'running.label', ['running session', '运行中的会话'], 'ArrowRight', () => stepRunning(ctx))

        // Fallback for shells whose native bridge drops a key before dispatch: handle the same
        // chords on the page. The native path cancels the event, so only one of the two paths fires.
        ctx.effect(() => {
          const onKeyDown = event => {
            if (event.defaultPrevented || !event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return
            // Synthetic senders may report an empty code, so accept the legacy key name as well.
            const pressed = event.code !== '' ? event.code : event.key
            const run = pressed === 'ArrowUp' ? () => step(ctx, -1)
              : pressed === 'ArrowDown' ? () => step(ctx, 1)
                : pressed === 'ArrowLeft' ? () => recent(ctx, history)
                  : pressed === 'ArrowRight' ? () => stepRunning(ctx)
                    : undefined
            if (run === undefined || candidates(ctx).length < 2) return
            event.preventDefault()
            event.stopPropagation()
            run()
          }
          window.addEventListener('keydown', onKeyDown, true)
          return () => window.removeEventListener('keydown', onKeyDown, true)
        }, 'dsh-session-cycling: keyboard fallback')
      },
    }
  },
})
