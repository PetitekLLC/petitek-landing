(function () {
  'use strict';

  const SCRIPT = document.currentScript;
  const API_URL = SCRIPT?.dataset?.api || '';
  const PRODUCT_URL = SCRIPT?.dataset?.productUrl || '#';

  const state = {
    assessmentId: getOrCreateAssessmentId(),
    visitorId: readCookie('petitek_visitor_id') || null,
    turn: 0,
    profile: {
      petType: null,
      petName: null,
      behaviors: [],
      currentBehavior: null,
      knowsRule: null,
      verbalCue: null,
      cueReliability: null,
      whenOccurs: null,
      predictableLocation: null,
      multiPet: null,
      targetable: null,
      safetyExclusion: false,
      trainingStage: null
    },
    complete: false
  };

  injectShell();
  bindShell();
  track('fit_widget_loaded');

  function injectShell() {
    if (document.getElementById('cbfit-overlay')) return;
    document.body.classList.add('cbfit-banner-active');

    const launcher = document.createElement('button');
    launcher.className = 'cbfit-launcher';
    launcher.id = 'cbfit-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.innerHTML = 'Will ChatrBox work for your pet? <span>Find out →</span>';

    const overlay = document.createElement('div');
    overlay.className = 'cbfit-overlay';
    overlay.id = 'cbfit-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <section class="cbfit-panel" role="dialog" aria-modal="true" aria-labelledby="cbfit-title">
        <header class="cbfit-head">
          <div class="cbfit-mark" aria-hidden="true">🐾</div>
          <div class="cbfit-head-copy">
            <h2 class="cbfit-title" id="cbfit-title">ChatrBox Fit Conversation</h2>
            <p class="cbfit-subtitle">Tell us what’s happening. We’ll ask only what we need.</p>
          </div>
          <button class="cbfit-close" type="button" aria-label="Close assessment">×</button>
        </header>
        <div class="cbfit-body">
          <div class="cbfit-progress" aria-label="Assessment progress"><div id="cbfit-progress-bar"></div></div>
          <div class="cbfit-thread" id="cbfit-thread" aria-live="polite"></div>
        </div>
        <div class="cbfit-composer" id="cbfit-composer">
          <div class="cbfit-input-wrap">
            <textarea class="cbfit-textarea" id="cbfit-textarea" rows="1" maxlength="900" aria-label="Describe your pet behavior" placeholder="Tell us what’s going on…"></textarea>
            <button class="cbfit-send" id="cbfit-send" type="button" aria-label="Send">➜</button>
          </div>
          <p class="cbfit-help">Type naturally, or use your phone keyboard’s dictation. Results are guidance, not a guarantee.</p>
        </div>
      </section>`;

    document.body.appendChild(launcher);
    document.body.appendChild(overlay);
  }

  function bindShell() {
    const launcher = qs('#cbfit-launcher');
    const overlay = qs('#cbfit-overlay');
    const close = qs('.cbfit-close');
    const send = qs('#cbfit-send');
    const input = qs('#cbfit-textarea');

    launcher.addEventListener('click', open);
    close.addEventListener('click', closeWidget);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeWidget();
    });
    send.addEventListener('click', sendTyped);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTyped();
      }
    });
  }

  function open() {
    const overlay = qs('#cbfit-overlay');
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    track('fit_assessment_opened');
    if (!state.turn) startConversation();
    setTimeout(() => qs('#cbfit-textarea')?.focus(), 50);
  }

  function closeWidget() {
    const overlay = qs('#cbfit-overlay');
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    track('fit_assessment_closed', { completed: state.complete });
  }

  function startConversation() {
    state.turn = 1;
    assistant(`Hi. To see whether ChatrBox may be a fit for your situation, tell us about the behavior or behaviors you’d like to improve.\n\nShare whatever you think is important — what your pet is doing, when or where it happens, and what happens when you correct them.`);
    setProgress(8);
  }

  async function sendTyped() {
    if (state.complete) return;
    const input = qs('#cbfit-textarea');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    user(text);
    await processInput(text);
  }

  async function processInput(text, explicitKey) {
    state.turn += 1;
    setBusy(true);

    try {
      if (API_URL) {
        const apiReply = await callApi(text, explicitKey);
        if (apiReply) {
          applyApiState(apiReply);
          renderApiReply(apiReply);
          return;
        }
      }
      localInterpret(text, explicitKey);
      nextLocalStep();
    } catch (err) {
      console.warn('ChatrBox fit API unavailable; using local rules.', err);
      localInterpret(text, explicitKey);
      nextLocalStep();
    } finally {
      setBusy(false);
    }
  }

  async function callApi(text, explicitKey) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        assessment_id: state.assessmentId,
        visitor_id: state.visitorId,
        message: text,
        answer_key: explicitKey || null,
        client_state: state.profile
      })
    });
    if (!response.ok) throw new Error('Fit API returned ' + response.status);
    return response.json();
  }

  function applyApiState(reply) {
    if (reply.assessment_id) state.assessmentId = reply.assessment_id;
    if (reply.profile) Object.assign(state.profile, reply.profile);
    if (reply.completed) state.complete = true;
  }

  function renderApiReply(reply) {
    if (reply.message) assistant(reply.message);
    if (Array.isArray(reply.choices) && reply.choices.length) {
      choices(reply.choices.map((c) => ({ label: c.label, key: c.key, value: c.value || c.label })));
    }
    if (reply.result) renderResult(reply.result);
    setProgress(reply.progress || (state.complete ? 100 : Math.min(92, 15 + state.turn * 13)));
  }

  function localInterpret(text, explicitKey) {
    const p = state.profile;
    const raw = text.trim();
    const t = raw.toLowerCase();

    if (explicitKey) {
      const [field, value] = explicitKey.split(':');
      if (field && value !== undefined) p[field] = normalize(value);
    }

    if (!p.petType) {
      if (/\b(cat|kitten|kitty|feline)\b/.test(t)) p.petType = 'cat';
      if (/\b(dog|puppy|canine)\b/.test(t)) p.petType = 'dog';
    }

    if (!p.petName) {
      const namePatterns = [
        /(?:my (?:dog|cat)(?: named| is|,)?|his name is|her name is|named)\s+([A-Z][a-z]{1,20})/,
        /(?:dog|cat)\s+([A-Z][a-z]{1,20})\s+(?:keeps|always|often|likes|gets|goes|jumps|scratches)/
      ];
      for (const re of namePatterns) {
        const m = raw.match(re);
        if (m?.[1]) { p.petName = m[1]; break; }
      }
    }

    const danger = /(chase[sd]? cars?|traffic|bite[sd]? (people|children)|attack|run(?:s|ning)? into (?:the )?road|escape[sd]? into traffic)/.test(t);
    if (danger) {
      p.safetyExclusion = true;
      p.currentBehavior = 'safety_sensitive_outdoor';
      upsertBehavior('safety_sensitive_outdoor', raw);
      return;
    }

    const behaviorRules = [
      ['counter_access', /(counter|table|counter surf)/],
      ['furniture_access', /(couch|sofa|chair|bed|furniture)/],
      ['restricted_area', /(room|area|upstairs|downstairs|kitchen|dining room|bedroom|off[- ]?limits|go(?:es|ing)? into)/],
      ['trash_food_items', /(trash|garbage|food|plant|plants|pantry|steal(?:s|ing)? food|get(?:s|ting)? into)/],
      ['scratching', /(scratch|scratching)/],
      ['marking', /(marking|spray(?:s|ing)?|urinating|pee(?:s|ing)?)/],
      ['jumping_people', /(jump(?:s|ing)? (?:up )?on (?:people|guests|me|us))/],
      ['other_location_action', /(dig(?:s|ging)?|chew(?:s|ing)?|lick(?:s|ing)?)/]
    ];
    if (!p.currentBehavior) {
      for (const [key, re] of behaviorRules) {
        if (re.test(t)) {
          p.currentBehavior = key;
          upsertBehavior(key, raw);
          break;
        }
      }
    }

    if (/(knows? (?:the )?rule|knows? (?:he|she|they) (?:is|are)n['’]?t supposed|knows? (?:not|better)|already trained|understands? (?:the )?rule)/.test(t)) p.knowsRule = 'yes';
    if (/(still learning|still training|trying to teach|we['’]?re teaching)/.test(t)) p.knowsRule = 'learning';
    if (/(doesn['’]?t know|not trained|never trained|does not understand)/.test(t)) p.knowsRule = 'no';

    if (/(responds? to (?:my|our) voice|when i (?:say|tell)|verbal|command|cue|\boff\b|leave it|\bno\b)/.test(t)) p.verbalCue = 'yes';
    if (/(ignores? (?:me|my voice)|doesn['’]?t respond|does not respond)/.test(t)) p.verbalCue = 'no';

    if (/(usually|most of the time|almost always|reliably)/.test(t) && /(stop|respond|listen|obey)/.test(t)) p.cueReliability = 'usually';
    if (/(sometimes|inconsistent)/.test(t) && /(stop|respond|listen|obey)/.test(t)) p.cueReliability = 'sometimes';
    if (/(rarely|hardly ever)/.test(t) && /(stop|respond|listen|obey)/.test(t)) p.cueReliability = 'rarely';

    if (/(when (?:we|i)(?:'re| are)? (?:gone|away)|when (?:we|i) leave|not watching|when nobody|when no one|unattended|at night after we)/.test(t)) p.whenOccurs = 'unobserved';
    if (/(whether (?:we|i)(?:'m| am| are)? there|both when|even when (?:we|i)(?:'m| am| are)? there)/.test(t)) p.whenOccurs = 'both';

    if (/(same spot|same place|one spot|specific (?:place|area|room)|few (?:spots|places|areas)|predictable)/.test(t)) p.predictableLocation = 'yes';
    if (/(anywhere|all over|throughout the house|random places|unpredictable)/.test(t)) p.predictableLocation = 'no';

    if (/(several dogs|multiple dogs|more than one dog|several cats|multiple cats|more than one cat|other pets)/.test(t)) p.multiPet = 'yes';
  }

  function nextLocalStep() {
    const p = state.profile;
    setProgress(Math.min(88, 14 + state.turn * 13));

    if (p.safetyExclusion) {
      renderResult({
        fit: 'Not Recommended for This Behavior',
        summary: 'The behavior you described involves an immediate safety risk that ChatrBox should not be relied on to manage.',
        why: 'ChatrBox is an indoor reinforcement tool. Behaviors involving moving vehicles, traffic, aggression, or escape risk need direct training and reliable physical safety management.',
        mode: 'not_recommended',
        steps: [
          'Use direct training and appropriate physical management for this behavior.',
          'Do not rely on an automatic indoor voice device for immediate safety control.',
          'If there is another indoor behavior you want help with, assess that separately.'
        ]
      });
      return;
    }

    if (!p.petType) {
      assistant('Thanks — first, is the pet you’re describing a dog or a cat?');
      choices([
        { label: '🐶 Dog', key: 'petType:dog', value: 'Dog' },
        { label: '🐱 Cat', key: 'petType:cat', value: 'Cat' }
      ]);
      return;
    }

    if (!p.currentBehavior) {
      assistant(`Got it${petRef()}. Which of these is closest to what’s happening?`);
      choices([
        { label: 'Going somewhere off-limits', key: 'currentBehavior:restricted_area', value: 'Going into an off-limits area' },
        { label: 'Getting onto or into something', key: 'currentBehavior:furniture_access', value: 'Getting onto or into something' },
        { label: 'A specific action in one area', key: 'currentBehavior:other_location_action', value: 'A specific unwanted action in one area' },
        { label: 'It can happen almost anywhere', key: 'currentBehavior:unpredictable_behavior', value: 'The behavior can happen almost anywhere' },
        { label: 'Something else', key: 'currentBehavior:other', value: 'Something else' }
      ]);
      return;
    }

    if (!p.knowsRule) {
      assistant(`${petNameOr('your pet')} — does ${pronoun()} already understand that this behavior or area is not allowed?`);
      choices([
        { label: 'Yes — clearly knows the rule', key: 'knowsRule:yes', value: 'Yes, clearly knows the rule' },
        { label: 'Mostly — but still tests it', key: 'knowsRule:mostly', value: 'Mostly, but still tests the rule' },
        { label: 'Still learning', key: 'knowsRule:learning', value: 'Still learning the rule' },
        { label: 'No — not yet', key: 'knowsRule:no', value: 'No, not yet' }
      ]);
      return;
    }

    if (!p.verbalCue) {
      const lead = p.knowsRule === 'learning'
        ? `${petNameOr('your pet')} is still learning. When you correct the behavior now, does ${pronoun()} respond to your voice or a familiar verbal cue?`
        : `When you use your normal verbal cue or correction for this behavior, does ${petNameOr('your pet')} understand what you mean?`;
      assistant(lead);
      choices([
        { label: 'Yes', key: 'verbalCue:yes', value: 'Yes' },
        { label: 'Usually', key: 'verbalCue:usually', value: 'Usually' },
        { label: 'Sometimes', key: 'verbalCue:sometimes', value: 'Sometimes' },
        { label: 'No / no verbal cue yet', key: 'verbalCue:no', value: 'No' }
      ]);
      return;
    }

    if (!p.whenOccurs && p.knowsRule !== 'no') {
      assistant(`When is ${petNameOr('your pet')} most likely to do this?`);
      choices([
        { label: 'Mostly when I’m away or not watching', key: 'whenOccurs:unobserved', value: 'Mostly when I’m away or not watching' },
        { label: 'Both when I’m there and away', key: 'whenOccurs:both', value: 'Both when I’m there and away' },
        { label: 'Mostly when I’m there', key: 'whenOccurs:observed', value: 'Mostly when I’m there' },
        { label: 'Not sure', key: 'whenOccurs:unknown', value: 'Not sure' }
      ]);
      return;
    }

    if (needsLocationCheck(p.currentBehavior) && !p.predictableLocation) {
      assistant(`Can the behavior usually be narrowed to one place or a few predictable places where ChatrBox could be aimed?`);
      choices([
        { label: 'Yes — one specific place', key: 'predictableLocation:yes', value: 'One specific place' },
        { label: 'Yes — a few predictable places', key: 'predictableLocation:few', value: 'A few predictable places' },
        { label: 'No — it happens almost anywhere', key: 'predictableLocation:no', value: 'It can happen almost anywhere' },
        { label: 'Not sure', key: 'predictableLocation:unknown', value: 'Not sure' }
      ]);
      return;
    }

    if (p.multiPet === 'yes' && !p.targetable) {
      assistant(`Because there are other pets in the home, could ChatrBox be positioned so it mainly detects the problem activity — for example on the couch rather than normal movement on the floor?`);
      choices([
        { label: 'Yes — I can isolate the activity', key: 'targetable:yes', value: 'Yes, the activity can be isolated' },
        { label: 'Probably', key: 'targetable:probably', value: 'Probably' },
        { label: 'No — the other pets would trigger it too', key: 'targetable:no', value: 'No' },
        { label: 'Not sure', key: 'targetable:unknown', value: 'Not sure' }
      ]);
      return;
    }

    renderResult(buildLocalResult());
  }

  function buildLocalResult() {
    const p = state.profile;
    const name = petNameOr('Your pet');

    if (p.knowsRule === 'no' && p.verbalCue === 'no') {
      return {
        fit: 'Training Recommended First',
        summary: `${name} does not yet appear to have an established rule or verbal cue for this behavior.`,
        why: 'ChatrBox works best when it reinforces something the pet already understands rather than trying to create meaning from a brand-new recorded correction.',
        mode: 'training_first',
        steps: [
          'Teach the rule directly while you are present.',
          'Pair the rule with a consistent word or phrase your pet recognizes.',
          'Once the response becomes meaningful, reassess ChatrBox for reinforcement.'
        ]
      };
    }

    if (p.knowsRule === 'learning' && p.verbalCue !== 'no') {
      return {
        fit: 'Potential Fit — Pre-Training Recommended',
        summary: `${name} is still learning the rule, but already responds to your voice. That gives ChatrBox a useful role in the training process.`,
        why: 'Use Wi-Fi/manual control first so you can deliver the familiar recorded correction at the right moment while you supervise. Once the rule is established, transition to automatic operation.',
        mode: 'wifi_pretraining',
        steps: [
          'Place ChatrBox where the behavior can be observed and targeted.',
          'Record the same familiar correction you already use.',
          'In Wi-Fi mode, trigger the message when the behavior begins.',
          'After the rule is established, test automatic detection for ongoing reinforcement.'
        ]
      };
    }

    let score = 0;
    if (p.knowsRule === 'yes') score += 3;
    if (p.knowsRule === 'mostly') score += 2;
    if (['yes', 'usually'].includes(p.verbalCue)) score += 3;
    if (p.verbalCue === 'sometimes') score += 1;
    if (p.whenOccurs === 'unobserved') score += 3;
    if (p.whenOccurs === 'both') score += 1;
    if (['yes', 'few'].includes(p.predictableLocation) || !needsLocationCheck(p.currentBehavior)) score += 2;
    if (p.predictableLocation === 'no') score -= 2;
    if (p.targetable === 'no') score -= 2;

    const strong = score >= 7;
    return {
      fit: strong ? 'Strong Fit' : 'Potential Fit',
      summary: strong
        ? `${name} shows several of the strongest indicators for ChatrBox: an understood rule, a meaningful verbal correction, and a situation that can be targeted for reinforcement.`
        : `${name} has some positive ChatrBox indicators, but setup, repetition, or additional training may play a larger role in the outcome.`,
      why: p.whenOccurs === 'unobserved'
        ? `A particularly positive sign is that the behavior happens mainly when you are away or not watching — exactly when ChatrBox can extend a familiar correction beyond your physical presence.`
        : `ChatrBox can reinforce the familiar rule at the moment the behavior occurs, but the result will depend on how consistently the behavior can be detected and how meaningful the recorded cue already is.`,
      mode: strong ? 'automatic' : 'conditional',
      steps: [
        'Position ChatrBox so its detection area is focused on the problem activity.',
        'Record the same familiar word or correction your pet already understands.',
        'Let ChatrBox deliver that familiar correction when the behavior occurs.',
        'Use consistent placement and repetition; behavior change may take time.'
      ]
    };
  }

  function renderResult(result) {
    state.complete = true;
    setProgress(100);
    assistant(result.why || 'Based on what you told us, here’s our assessment.');

    const thread = qs('#cbfit-thread');
    const card = document.createElement('div');
    card.className = 'cbfit-result';
    const name = petNameOr('your pet');
    card.innerHTML = `
      <div class="cbfit-result-top">
        <div class="cbfit-result-label">ChatrBox recommendation</div>
        <h3>${escapeHtml(result.fit)}</h3>
        <p>${escapeHtml(result.summary || '')}</p>
      </div>
      <div class="cbfit-result-body">
        <h4>How ChatrBox could work for ${escapeHtml(name)}</h4>
        <ol>${(result.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
        <div class="cbfit-note"><strong>What to expect:</strong> ChatrBox reinforces behavior over time. Proper setup, repetition, the existing training relationship, and the individual pet can affect results. No particular behavioral result is guaranteed.</div>
        <div class="cbfit-cta-row">
          <a class="cbfit-primary" href="${escapeAttr(withAssessmentId(PRODUCT_URL))}" data-cbfit-product>See how ChatrBox works</a>
          <button class="cbfit-secondary" type="button" data-cbfit-restart>Start a new assessment</button>
        </div>
      </div>`;
    thread.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    qs('#cbfit-composer').classList.add('cbfit-hidden');

    card.querySelector('[data-cbfit-product]').addEventListener('click', () => track('fit_result_cta', { fit: result.fit, assessment_id: state.assessmentId }));
    card.querySelector('[data-cbfit-restart]').addEventListener('click', restart);
    track('fit_assessment_completed', { fit: result.fit, mode: result.mode, assessment_id: state.assessmentId });
  }

  function restart() {
    state.assessmentId = newAssessmentId();
    writeCookie('petitek_fit_assessment_id', state.assessmentId, 14);
    state.turn = 0;
    state.complete = false;
    Object.assign(state.profile, {
      petType: null, petName: null, behaviors: [], currentBehavior: null, knowsRule: null,
      verbalCue: null, cueReliability: null, whenOccurs: null, predictableLocation: null,
      multiPet: null, targetable: null, safetyExclusion: false, trainingStage: null
    });
    qs('#cbfit-thread').innerHTML = '';
    qs('#cbfit-composer').classList.remove('cbfit-hidden');
    startConversation();
  }

  function choices(items) {
    const thread = qs('#cbfit-thread');
    const wrap = document.createElement('div');
    wrap.className = 'cbfit-chips';
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.className = 'cbfit-chip';
      btn.type = 'button';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        Array.from(wrap.querySelectorAll('button')).forEach((b) => b.disabled = true);
        user(item.value || item.label);
        processInput(item.value || item.label, item.key);
      });
      wrap.appendChild(btn);
    });
    thread.appendChild(wrap);
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function assistant(text) { bubble('assistant', text); }
  function user(text) { bubble('user', text); }

  function bubble(role, text) {
    const thread = qs('#cbfit-thread');
    const row = document.createElement('div');
    row.className = `cbfit-msg ${role}`;
    const b = document.createElement('div');
    b.className = 'cbfit-bubble';
    b.textContent = text;
    row.appendChild(b);
    thread.appendChild(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setBusy(on) {
    const send = qs('#cbfit-send');
    const input = qs('#cbfit-textarea');
    if (send) send.disabled = on;
    if (input) input.disabled = on;
  }

  function setProgress(percent) {
    const bar = qs('#cbfit-progress-bar');
    if (bar) bar.style.width = `${Math.max(6, Math.min(100, percent))}%`;
  }

  function upsertBehavior(type, description) {
    const existing = state.profile.behaviors.find((b) => b.type === type);
    if (existing) existing.description = description;
    else state.profile.behaviors.push({ type, description });
  }

  function needsLocationCheck(type) {
    return ['marking', 'scratching', 'other_location_action', 'unpredictable_behavior', 'other'].includes(type);
  }

  function petRef() {
    if (state.profile.petName) return ` — I’m following you about ${state.profile.petName}`;
    return '';
  }

  function petNameOr(fallback) { return state.profile.petName || fallback; }
  function pronoun() { return 'they'; }
  function normalize(v) { return String(v).replaceAll('_', ' '); }

  function getOrCreateAssessmentId() {
    const existing = readCookie('petitek_fit_assessment_id');
    if (existing) return existing;
    const id = newAssessmentId();
    writeCookie('petitek_fit_assessment_id', id, 14);
    return id;
  }

  function newAssessmentId() {
    if (window.crypto?.randomUUID) return 'FA_' + crypto.randomUUID();
    return 'FA_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function withAssessmentId(url) {
    if (!url || url === '#') return '#';
    try {
      const u = new URL(url, window.location.href);
      u.searchParams.set('fit_assessment_id', state.assessmentId);
      return u.toString();
    } catch (_) { return url; }
  }

  function readCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function writeCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  }

  function track(eventName, params) {
    const payload = Object.assign({ assessment_id: state.assessmentId }, params || {});
    if (typeof window.gtag === 'function') window.gtag('event', eventName, payload);
    window.dispatchEvent(new CustomEvent('chatrbox-fit-event', { detail: { event: eventName, ...payload } }));
  }

  function qs(selector) { return document.querySelector(selector); }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }
  function escapeAttr(value) { return escapeHtml(value); }
})();
