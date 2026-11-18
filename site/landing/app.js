/* Live demo of the Bridgecast console. Plain JS, no dependencies. */
;(function () {
  'use strict'
  var $ = function (s, r) {
    return (r || document).querySelector(s)
  }
  var $$ = function (s, r) {
    return Array.prototype.slice.call((r || document).querySelectorAll(s))
  }
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function inView(el, cb, t) {
    if (!('IntersectionObserver' in window)) return cb(true)
    new IntersectionObserver(
      function (es) {
        cb(es[0].isIntersecting)
      },
      { threshold: t || 0.35 }
    ).observe(el)
  }

  var DECKS = [
    ['Opening Keynote', 'c1', ['Welcome', 'Agenda', 'Meet the speakers'], '.pptx · Native'],
    ['Regional Trade Panel', 'c2', ['Panel one', 'Panel two', 'Questions'], '.pptx · Vector'],
    ['Sponsor Reel', 'c3', ['Our partners'], 'Folder · Still images']
  ]
  var EXTRA = [
    ['Lunch Break Loop', 'c4', ['Back at 13:00'], 'Folder · Still images'],
    ['Awards Ceremony', 'c5', ['Nominees', 'Winners'], '.pptx · Native'],
    ['Panel Q&A', 'c6', ['Ask a question'], 'Web page'],
    ['Closing Remarks', 'c1', ['Thank you', 'See you next year'], '.pdf · Vector']
  ]
  function slide(cls, title, sub) {
    return '<div class="sl ' + cls + '"><strong>' + title + '</strong>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>'
  }

  /* ---------- hero console ---------- */
  function Console(root) {
    var list = $('#c-list', root),
      mon = $('#c-mon', root),
      tally = $('#c-tally', root),
      hint = $('#c-hint', root),
      now = $('#c-now', root),
      count = $('#c-count', root),
      addBtn = $('#c-add', root)
    var decks, cur, shown, frozen, black, kv, fade, extra, last, auto, timer, visible
    var STEPS = [['add'], ['next'], ['freeze'], ['next'], ['next'], ['freeze'], ['black'], ['black'], ['kv'], ['kv'], ['pick', 1], ['next'], ['add'], ['next'], ['add']]

    function nextOf(c) {
      var d = decks[c.d]
      return c.s + 1 < d[2].length ? { d: c.d, s: c.s + 1 } : { d: (c.d + 1) % decks.length, s: 0 }
    }
    function prevOf(c) {
      if (c.s > 0) return { d: c.d, s: c.s - 1 }
      var p = (c.d + decks.length - 1) % decks.length
      return { d: p, s: decks[p][2].length - 1 }
    }
    function title(p) {
      return decks[p.d][2][p.s]
    }
    function addRow(d, i, enter) {
      var li = document.createElement('li')
      li.innerHTML =
        '<button type="button" class="deck' + (enter ? ' enter' : '') + '" data-i="' + i + '"><span class="thumb ' + d[1] + '"></span><span class="dn"><b>' + d[0] + '</b><i>' + d[3] + '</i></span><span class="tg"></span></button>'
      list.appendChild(li)
    }
    function reset() {
      decks = DECKS.slice()
      cur = { d: 0, s: 0 }
      shown = { d: 0, s: 0 }
      frozen = black = kv = false
      extra = 0
      last = ''
      list.innerHTML = ''
      decks.forEach(function (d, i) {
        addRow(d, i, false)
      })
      render()
    }
    function render() {
      var s = title(shown),
        key = shown.d + '.' + shown.s
      if (key !== last) {
        $('.s', mon).innerHTML = slide(decks[shown.d][1], s, decks[shown.d][0])
        if (fade && last && !reduce) {
          mon.classList.remove('anim')
          void mon.offsetWidth
          mon.classList.add('anim')
        }
        last = key
      }
      var st = black ? 'black' : kv ? 'kv' : frozen ? 'frozen' : 'live'
      mon.dataset.s = st
      tally.dataset.s = st
      tally.textContent = { black: 'BLACK', kv: 'KV', frozen: 'FROZEN', live: 'LIVE' }[st]
      mon.classList.toggle('is-black', black)
      mon.classList.toggle('is-kv', kv && !black)
      mon.classList.toggle('is-frozen', frozen && !black && !kv)
      now.textContent = decks[shown.d][0]
      var n = nextOf(cur)
      $$('.deck', list).forEach(function (b, i) {
        var t = $('.tg', b),
          h = ''
        b.classList.toggle('on', i === shown.d)
        if (i === shown.d) h = '<span class="tag" data-s="live">LIVE</span>'
        else if (i === n.d) h = '<span class="tag" data-s="next">NEXT</span>'
        if (t.innerHTML !== h) t.innerHTML = h
      })
      var pr = { freeze: frozen, black: black, kv: kv }
      $$('[data-a]', root).forEach(function (b) {
        if (b.dataset.a in pr) b.setAttribute('aria-pressed', String(pr[b.dataset.a]))
      })
      $$('.seg button', root).forEach(function (b) {
        b.setAttribute('aria-pressed', String((b.dataset.t === 'fade') === fade))
      })
      count.textContent = decks.length + ' decks'
      addBtn.disabled = decks.length >= 7
      addBtn.textContent = decks.length >= 7 ? 'Library full' : 'Add deck'
      hint.textContent = black
        ? 'Black. The screen stays black until you press B again.'
        : kv
          ? 'KV. The key visual is on the screen.'
          : frozen
            ? 'Frozen. The audience still sees "' + s + '". Next up: ' + title(n) + '.'
            : 'Next: ' + title(n) + ' · ' + decks[n.d][0]
    }
    var A = {
      next: function () {
        cur = nextOf(cur)
        if (!frozen) shown = cur
      },
      prev: function () {
        cur = prevOf(cur)
        if (!frozen) shown = cur
      },
      freeze: function () {
        frozen = !frozen
        if (!frozen) shown = cur
      },
      black: function () {
        black = !black
      },
      kv: function () {
        kv = !kv
      },
      add: function () {
        if (decks.length >= 7) return
        var d = EXTRA[extra++ % EXTRA.length]
        decks.push(d)
        addRow(d, decks.length - 1, true)
      },
      pick: function (i) {
        cur = { d: i, s: 0 }
        if (!frozen) shown = cur
      }
    }
    function act(a, arg) {
      A[a](arg)
      render()
    }
    function flash(a, arg) {
      var el = a === 'pick' ? $$('.deck', list)[arg] : $('[data-a="' + a + '"]', root)
      if (!el) return
      el.classList.add('flash')
      setTimeout(function () {
        el.classList.remove('flash')
      }, 280)
    }
    function stop() {
      if (!auto) return
      auto = false
      clearTimeout(timer)
      frozen = black = kv = false
      shown = cur
      render()
    }
    function tick(i) {
      if (!auto || !visible) return
      if (i > 0 && i % STEPS.length === 0) reset()
      var s = STEPS[i % STEPS.length]
      flash(s[0], s[1])
      act(s[0], s[1])
      timer = setTimeout(function () {
        tick(i + 1)
      }, 1300)
    }
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a],[data-t],.deck')
      if (!b) return
      stop()
      if (b.classList.contains('deck')) return act('pick', +b.dataset.i)
      if (b.dataset.t) {
        fade = b.dataset.t === 'fade'
        return render()
      }
      act(b.dataset.a)
    })
    root.addEventListener('pointerdown', function () {
      stop()
    })
    root.addEventListener('keydown', function (e) {
      if (e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return
      var k = e.key,
        a = null
      if (k === ' ' || k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown') a = 'next'
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') a = 'prev'
      else if (k === 'f' || k === 'F') a = 'freeze'
      else if (k === 'b' || k === 'B' || k === '.') a = 'black'
      else if (k === 'k' || k === 'K') a = 'kv'
      if (!a) return
      e.preventDefault()
      stop()
      flash(a)
      act(a)
    })
    fade = true
    reset()
    auto = !reduce
    inView(root, function (v) {
      visible = v
      if (v && auto) {
        clearTimeout(timer)
        timer = setTimeout(function () {
          tick(0)
        }, 900)
      } else clearTimeout(timer)
    })
  }

  /* ---------- how it works ---------- */
  function How() {
    var rng = $('#how-rng')
    if (!rng) return
    var scenes = $$('.how-scene .st'),
      names = $$('.stages li'),
      h = $('#how-h'),
      p = $('#how-p'),
      tr = $('.rng .tr i'),
      take = $('#how-mon'),
      ti,
      tb
    var T = [
      ['Add every', 'deck.', 'Drop .pptx, .ppt or .pdf files, or add a web page. Every deck is also converted to PNG slides as a fallback.'],
      ['Line up the', 'next slide.', 'Decks keep their order. The one on air is marked LIVE and the next one is marked NEXT.'],
      ['Take the next', 'slide to air.', 'Space or the right arrow takes the next slide to air, as a cut or a fade.'],
      ['Recover', 'without a blink.', 'If PowerPoint or a web page fails, the output keeps the last good frame or shows the PNG of the same slide. It never goes black and never shows the desktop.']
    ]
    var sec = $('#how'),
      ghost = $('#how-ghost'),
      scrolly = !reduce && !!sec
    if (scrolly) sec.classList.add('scrolly')
    function set(v) {
      v = +v
      if (sec) sec.setAttribute('data-v', v)
      if (ghost) ghost.textContent = names[v].textContent.trim()
      rng.value = v
      rng.setAttribute('aria-valuetext', names[v].textContent.trim())
      tr.parentNode.style.setProperty('--v', v)
      scenes.forEach(function (s, i) {
        s.classList.toggle('on', i === v)
      })
      names.forEach(function (n, i) {
        n.classList.toggle('cur', i === v)
      })
      h.innerHTML = '<span>' + T[v][0] + '</span><span>' + T[v][1] + '</span>'
      p.textContent = T[v][2]
      ;[h, p].forEach(function (el) {
        el.classList.remove('swap')
        void el.offsetWidth
        el.classList.add('swap')
      })
      clearInterval(ti)
      clearInterval(tb)
      if (v === 1 && !reduce) {
        var rows = $$('.rows3 li'), n = 0,
          up = $('.st[data-i="1"] .dim')
        var seq = [['Opening Keynote', 'Regional Trade Panel', 'Up next: Agenda'], ['Regional Trade Panel', 'Sponsor Reel', 'Up next: Panel one'], ['Sponsor Reel', 'Opening Keynote', 'Up next: Welcome']]
        function lineup() {
          var q = seq[n % 3]
          rows.forEach(function (r) {
            var nm = $('b', r).textContent, t = $('.tag', r)
            if (!t) { t = document.createElement('span'); r.replaceChild(t, r.lastElementChild); t.className = 'tag' }
            t.style.opacity = nm === q[0] || nm === q[1] ? 1 : 0
            t.dataset.s = nm === q[0] ? 'live' : 'next'
            t.textContent = nm === q[0] ? 'LIVE' : 'NEXT'
            t.classList.toggle('pulse', nm === q[1])
          })
          up.textContent = q[2]
        }
        lineup()
        tb = setInterval(function () { n++; lineup() }, 2000)
      }
      if (v === 3 && !reduce) {
        var chip = $('.st[data-i="3"] .chip'), msg = $('.st[data-i="3"] .hold span:last-child'), mon3 = $('.st[data-i="3"] .mon'), ok = false
        function rec() {
          chip.dataset.c = ok ? 'ready' : 'hold'
          chip.textContent = ok ? 'READY' : 'HOLD'
          chip.classList.toggle('pulse', !ok)
          msg.textContent = ok ? 'PowerPoint is back. Native playback resumes on the same slide.' : 'PowerPoint is not responding. The output holds the last good frame.'
          mon3.style.opacity = ok ? 1 : 0.92
        }
        ok = false; rec()
        tb = setInterval(function () { ok = !ok; rec() }, 2600)
      }
      if (v === 2 && !reduce) {
        var k = 0,
          S = [
            ['c1', 'Welcome', 'Opening Keynote'],
            ['c1', 'Agenda', 'Opening Keynote'],
            ['c1', 'Meet the speakers', 'Opening Keynote']
          ]
        ti = setInterval(function () {
          k = (k + 1) % S.length
          $('.s', take).innerHTML = slide(S[k][0], S[k][1], S[k][2])
          take.classList.remove('anim')
          void take.offsetWidth
          take.classList.add('anim')
        }, 1700)
      }
    }
    var cur = -1
    function onScroll() {
      var r = sec.getBoundingClientRect(),
        span = r.height - window.innerHeight,
        q = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0,
        f = q * 3
      sec.style.setProperty('--p', f.toFixed(3))
      var v = Math.min(3, Math.round(f))
      if (v !== cur) {
        cur = v
        set(v)
      }
    }
    function goto(i) {
      var top = sec.getBoundingClientRect().top + window.scrollY,
        span = sec.offsetHeight - window.innerHeight
      window.scrollTo({ top: top + (span * i) / 3 + 2, behavior: reduce ? 'auto' : 'smooth' })
    }
    if (scrolly) {
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onScroll)
      rng.addEventListener('input', function () {
        goto(+rng.value)
      })
    } else {
      rng.addEventListener('input', function () {
        set(rng.value)
      })
    }
    $$('.stages button').forEach(function (b, i) {
      b.addEventListener('click', function () {
        if (scrolly) goto(i)
        else set(i)
      })
    })
    $('.s', take).innerHTML = slide('c1', 'Welcome', 'Opening Keynote')
    if (scrolly) onScroll()
    else set(2)
  }

  /* ---------- feature widgets ---------- */
  function Freeze(root) {
    var mon = $('#wf-mon'),
      pEl = $('#wf-p'),
      oEl = $('#wf-o'),
      toast = $('#wf-toast'),
      p = 1,
      o = 1,
      f = false,
      b = false,
      k = false,
      run = false
    function draw() {
      $('.s', mon).innerHTML = slide('c1', 'Slide ' + o, 'Opening Keynote')
      pEl.textContent = p
      oEl.textContent = o
      var st = b ? 'black' : k ? 'kv' : f ? 'frozen' : 'live'
      mon.dataset.s = st
      mon.classList.toggle('is-black', b)
      mon.classList.toggle('is-kv', k && !b)
      mon.classList.toggle('is-frozen', f && !b && !k)
      $$('.key', root).forEach(function (el) {
        el.setAttribute('aria-pressed', String({ freeze: f, black: b, kv: k }[el.dataset.k]))
      })
      toast.hidden = !b
    }
    setInterval(function () {
      if (!run || reduce) return
      p = (p % 9) + 1
      if (!f) o = p
      draw()
    }, 1400)
    root.addEventListener('click', function (e) {
      var el = e.target.closest('.key')
      if (el) {
        var n = el.dataset.k
        if (n === 'freeze') {
          f = !f
          if (!f) o = p
        }
        if (n === 'black') b = !b
        if (n === 'kv') k = !k
        draw()
      }
      if (e.target.closest('#wf-undo')) {
        b = false
        draw()
      }
    })
    inView(root, function (v) {
      run = v
    }, 0.3)
    draw()
  }

  function Never(root) {
    var mon = $('#wn-mon'),
      chip = $('#wn-chip'),
      msg = $('#wn-msg'),
      btn = $('#wn-btn'),
      i = 0,
      down = false,
      run = false,
      S = ['Welcome', 'Agenda', 'Meet the speakers']
    function draw() {
      $('.s', mon).innerHTML = slide('c1', S[i], '')
      mon.classList.remove('anim')
      void mon.offsetWidth
      mon.classList.add('anim')
    }
    setInterval(function () {
      if (down || !run || reduce) return
      i = (i + 1) % S.length
      draw()
    }, 1500)
    btn.addEventListener('click', function () {
      down = !down
      chip.hidden = !down
      btn.setAttribute('aria-pressed', String(down))
      btn.textContent = down ? 'Restart PowerPoint' : 'Simulate a failure'
      msg.textContent = down
        ? 'PowerPoint is not responding. The output holds the last good frame.'
        : 'PowerPoint is back. The slide show returns to native.'
    })
    inView(root, function (v) {
      run = v
    }, 0.3)
    draw()
  }

  function Web() {
    var ul = $('#ww-list'),
      add = $('#ww-add'),
      n = 0,
      rows = [],
      names = ['canva.com/present', 'youtube.com/watch', 'example.com/slides']
    function draw() {
      ul.innerHTML = ''
      rows.forEach(function (r) {
        var li = document.createElement('li')
        if (!r.seen) li.className = 'new'
        r.seen = true
        li.innerHTML =
          '<span>' + r.name + '</span>' +
          (r.ready ? '<span class="chip" data-c="ready">Ready</span>' : '<span class="chip" data-c="loading"><i class="sp"></i>Loading</span>') +
          (r.live ? '<span class="tag" data-s="live">LIVE</span>' : '<button type="button" class="ub"' + (r.ready ? '' : ' disabled') + '>Take</button>')
        var b = $('button', li)
        if (b)
          b.addEventListener('click', function () {
            rows.forEach(function (x) {
              x.live = false
            })
            r.live = true
            draw()
          })
        ul.appendChild(li)
      })
    }
    add.addEventListener('click', function () {
      var r = { name: names[n++ % names.length], ready: false, live: false }
      rows.unshift(r)
      rows = rows.slice(0, 3)
      draw()
      setTimeout(function () {
        r.ready = true
        draw()
      }, 1100)
    })
    add.click()
  }

  function Net(root) {
    var rows = $$('.sw-row', root),
      sum = $('#wnet-sum')
    function draw() {
      var n = rows.filter(function (r) {
        return r.getAttribute('aria-checked') === 'true'
      }).length
      sum.textContent = n === 0 ? 'No output is on.' : 'The Program goes to ' + n + (n === 1 ? ' output.' : ' outputs.')
    }
    rows.forEach(function (r) {
      r.addEventListener('click', function () {
        r.setAttribute('aria-checked', String(r.getAttribute('aria-checked') !== 'true'))
        draw()
      })
    })
    draw()
  }

  function Edit() {
    var msg = $('#we-msg'),
      a = $('#we-apply'),
      r = $('#we-revert'),
      t
    var P = 'Edits pending. Changes apply when this deck leaves air.'
    function done(text) {
      msg.textContent = text
      a.disabled = r.disabled = true
      clearTimeout(t)
      t = setTimeout(function () {
        msg.textContent = P
        a.disabled = r.disabled = false
      }, 2400)
    }
    a.addEventListener('click', function () {
      done('Applied. The new version is on air.')
    })
    r.addEventListener('click', function () {
      done('Reverted to the imported file. The original was never modified.')
    })
  }

  document.addEventListener('DOMContentLoaded', function () {
    var c = $('#console')
    if (c) Console(c)
    How()
    ;[['.w-freeze', Freeze], ['.w-never', Never], ['.w-web', Web], ['.w-net', Net], ['.w-edit', Edit]].forEach(function (x) {
      var el = $(x[0])
      if (el) x[1](el)
    })
  })
})()
