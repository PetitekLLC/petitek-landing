(function () {
  'use strict';

  const SCRIPT = document.currentScript;
  const API_URL = SCRIPT?.dataset?.api || '';
  const PRODUCT_URL = SCRIPT?.dataset?.productUrl || '#';

  const blankProfile = () => ({
    petType: null,
    petName: null,
    currentBehavior: null,
    behaviorDescription: null,
    knowsRule: null,
    verbalCue: null,
    whenOccurs: null,
    predictableLocation: null,
    multiPet: null,
    targetable: null,
    safetyExclusion: false
  });

  const state = {
    assessmentId: getOrCreateAssessmentId(),
    visitorId: readCookie('petitek_visitor_id') || null,
    turn: 0,
    complete: false,
    profile: blankProfile()
  };

  injectShell();
  bindShell();
  track('fit_widget_loaded', { version: '2' });

  function injectShell() {
    if (document.getElementById('cbfit-overlay')) return;
    document.body.classList.add('cbfit-banner-active');

    const launcher = document.createElement('button');
    launcher.id = 'cbfit-launcher';
    launcher.className = 'cbfit-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.innerHTML = 'Will ChatrBox work for your pet? <span>Find out →</span>';

    const overlay = document.createElement('div');
    overlay.id = 'cbfit-overlay';
    overlay.className = 'cbfit-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <section class="cbfit-panel" role="dialog" aria-modal="true" aria-labelledby="cbfit-title">
        <header class="cbfit-head">
          <div class="cbfit-mark" aria-hidden="true">🐾</div>
          <div class="cbfit-head-copy">
            <h2 class="cbfit-title" id="cbfit-title">Will ChatrBox Work for Your Pet?</h2>
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

    launcher.addEventListener('click', openWidget);
    close.addEventListener('click', closeWidget);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeWidget();
    });
    send.addEventListener('click', sendTyped);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendTyped();
      }
    });
  }

  function openWidget() {
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
    assistant('Hi. Tell us about the behavior or behaviors you’d like to improve. Share whatever you know — what your pet is doing, when or where it happens, and what happens when you correct them.');
    setProgress(8);
  }

  async function sendTyped() {
    if (state.complete) return;
    const input = qs('#cbfit-textarea');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    user(text);
    await processInput(text, null);
  }

  async function processInput(text, answerKey) {
    state.turn += 1;
    setBusy(true);

    try {
      if (API_URL) {
        const reply = await callApi(text, answerKey);
        if (reply) {
          applyApiReply(reply);
          return;
        }
      }
      localInterpret(text, answerKey);
      nextLocalStep();
    } catch (error) {
      console.warn('Fit API unavailable; using local assessment rules.', error);
      localInterpret(text, answerKey);
      nextLocalStep();
    } finally {
      setBusy(false);
    }
  }

  async function callApi(message, answerKey) {
    const response = await fetch(API_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assessment_id: state.assessmentId,
        visitor_id: state.visitorId,
        message,
        answer_key: answerKey,
        client_state: state.profile
      })
    });
    if (!response.ok) throw new Error(`Fit API returned ${response.status}`);
    return response.json();
  }

  function applyApiReply(reply) {
    if (reply.assessment_id) {
      state.assessmentId = reply.assessment_id;
      writeCookie('petitek_fit_assessment_id', state.assessmentId, 14);
    }
    if (reply.profile) Object.assign(state.profile, normalizeApiProfile(reply.profile));
    if (reply.message) assistant(reply.message);
    if (Array.isArray(reply.choices) && reply.choices.length) renderChoices(reply.choices);
    if (reply.result) renderResult(reply.result);
    state.complete = Boolean(reply.completed || reply.result);
    setProgress(reply.progress || (state.complete ? 100 : Math.min(92, 16 + state.turn * 12)));
  }

  function normalizeApiProfile(profile) {
    const map = {
      pet_type: 'petType', pet_name: 'petName', current_behavior: 'currentBehavior',
      behavior_description: 'behaviorDescription', knows_rule: 'knowsRule', verbal_cue: 'verbalCue',
      when_occurs: 'whenOccurs', predictable_location: 'predictableLocation',
      multi_pet: 'multiPet', targetable: 'targetable', safety_exclusion: 'safetyExclusion'
    };
    const result = {};
    Object.entries(profile).forEach(([key, value]) => { result[map[key] || key] = value; });
    return result;
  }

  function localInterpret(text, answerKey) {
    const p = state.profile;
    const raw = String(text || '').trim();
    const t = raw.toLowerCase();

    if (answerKey) {
      const colon = answerKey.indexOf(':');
      if (colon > 0) {
        const field = answerKey.slice(0, colon);
        const value = answerKey.slice(colon + 1);
        if (Object.prototype.hasOwnProperty.call(p, field)) p[field] = value;
      }
    }

    if (!p.petType) {
      if (/\b(cat|kitten|kitty|feline)\b/.test(t)) p.petType = 'cat';
      else if (/\b(dog|puppy|canine)\b/.test(t)) p.petType = 'dog';
    }

    if (!p.petName) {
      const patterns = [
        /(?:my (?:dog|cat)(?: named| is|,)?|his name is|her name is|named)\s+([A-Z][a-z]{1,24})/,
        /(?:dog|cat)\s+([A-Z][a-z]{1,24})\s+(?:keeps|always|often|likes|gets|goes|jumps|scratches|pees)/
      ];
      for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match?.[1]) { p.petName = match[1]; break; }
      }
    }

    if (/(chase[sd]? cars?|run(?:s|ning)? into (?:the )?(?:road|street|traffic)|escape[sd]? into traffic|bite[sd]? (?:people|children)|attack(?:s|ed|ing)? (?:people|children))/i.test(t)) {
      p.safetyExclusion = true;
      p.currentBehavior = 'safety_sensitive';
      p.behaviorDescription = raw;
      return;
    }

    if (!p.currentBehavior) {
      const behaviorRules = [
        ['counter_access', /(counter surf|counter|table)/],
        ['furniture_access', /(couch|sofa|chair|bed|furniture)/],
        ['trash_food_items', /(trash|garbage|food|plant|pantry|get(?:s|ting)? into|steal(?:s|ing)? food)/],
        ['scratching', /(scratch|scratching)/],
        ['marking', /(marking|spray(?:s|ing)?|urinat(?:e|ing)|pee(?:s|ing)?)/],
        ['restricted_area', /(off[- ]?limits|restricted|room|upstairs|downstairs|dining room|bedroom|go(?:es|ing)? into)/],
        ['jumping_people', /(jump(?:s|ing)? (?:up )?on (?:people|guests|me|us))/],
        ['other_location_action', /(dig(?:s|ging)?|chew(?:s|ing)?|lick(?:s|ing)?)/]
      ];
      for (const [key, pattern] of behaviorRules) {
        if (pattern.test(t)) {
          p.currentBehavior = key;
          p.behaviorDescription = raw;
          break;
        }
      }
    }

    if (!p.knowsRule) {
      if (/(still learning|still training|trying to teach|we['’]?re teaching)/.test(t)) p.knowsRule = 'learning';
      else if (/(doesn['’]?t know|does not know|not trained|never trained|does not understand)/.test(t)) p.knowsRule = 'no';
      else if (/(knows? (?:the )?rule|knows? (?:he|she|they) (?:is|are)n['’]?t supposed|already trained|understands? (?:the )?rule|knows? better)/.test(t)) p.knowsRule = 'yes';
    }

    if (!p.verbalCue) {
      if (/(ignores? (?:me|my voice)|doesn['’]?t respond|does not respond|no verbal cue)/.test(t)) p.verbalCue = 'no';
      else if (/(sometimes).{0,30}(?:stop|respond|listen|obey)|(?:stop|respond|listen|obey).{0,30}sometimes/.test(t)) p.verbalCue = 'sometimes';
      else if (/(usually|most of the time|almost always).{0,30}(?:stop|respond|listen|obey)|(?:stop|respond|listen|obey).{0,30}(?:usually|most of the time|almost always)/.test(t)) p.verbalCue = 'usually';
      else if (/(responds? to (?:my|our) voice|verbal (?:cue|command|correction)|when i (?:say|tell)|\boff\b|leave it)/.test(t)) p.verbalCue = 'yes';
    }

    if (!p.whenOccurs) {
      if (/(when (?:we|i)(?:'re| are)? (?:gone|away)|when (?:we|i) leave|not watching|when nobody|when no one|unattended|when we are upstairs|after we go to bed)/.test(t)) p.whenOccurs = 'unobserved';
      else if (/(both when|even when (?:we|i)(?:'m| am| are)? there|whether (?:we|i)(?:'m| am| are)? there)/.test(t)) p.whenOccurs = 'both';
    }

    if (!p.predictableLocation) {
      if (/(same spot|same place|one spot|specific (?:place|area|room)|few (?:spots|places|areas)|predictable)/.test(t)) p.predictableLocation = 'yes';
      else if (/(anywhere|all over|throughout the house|random places|unpredictable)/.test(t)) p.predictableLocation = 'no';
    }

    if (!p.multiPet && /(several dogs|multiple dogs|more than one dog|several cats|multiple cats|more than one cat|other pets|two dogs|three dogs|two cats|three cats)/.test(t)) p.multiPet = 'yes';
  }

  function nextLocalStep() {
    const p = state.profile;
    setProgress(Math.min(90, 14 + state.turn * 13));

    if (p.safetyExclusion) {
      renderResult({
        fit: 'Not Recommended for This Behavior',
        mode: 'not_recommended',
        summary: 'The behavior you described involves an immediate safety risk that ChatrBox should not be relied on to manage.',
        why: 'ChatrBox is an indoor reinforcement tool. Behaviors involving traffic, moving vehicles, aggression, or escape risk require direct training and dependable physical safety management.',
        steps: [
          'Use direct training and appropriate physical management for this behavior.',
          'Do not rely on an automatic indoor voice device for immediate safety control.',
          'If there is another indoor behavior you want help with, assess that separately.'
        ]
      });
      return;
    }

    if (!p.petType) {
      assistant('Thanks. Is the pet you’re describing a dog or a cat?');
      renderChoices([
        { label: '🐶 Dog', key: 'petType:dog', value: 'Dog' },
        { label: '🐱 Cat', key: 'petType:cat', value: 'Cat' }
      ]);
      return;
    }

    if (!p.currentBehavior) {
      assistant('I want to make sure I understand the behavior correctly. Which description is closest?');
      renderChoices([
        { label: 'Going somewhere off-limits', key: 'currentBehavior:restricted_area', value: 'Going somewhere off-limits' },
        { label: 'Getting onto or into something', key: 'currentBehavior:furniture_access', value: 'Getting onto or into something' },
        { label: 'A specific unwanted action in one area', key: 'currentBehavior:other_location_action', value: 'A specific action in one area' },
        { label: 'It happens almost anywhere', key: 'currentBehavior:unpredictable_behavior', value: 'It happens almost anywhere' },
        { label: 'Something else', key: 'currentBehavior:other', value: 'Something else' }
      ]);
      return;
    }

    if (!p.knowsRule) {
      assistant(`${petNameOr('Your pet')} — do they already understand that this behavior or area is not allowed?`);
      renderChoices([
        { label: 'Yes — clearly knows the rule', key: 'knowsRule:yes' },
        { label: 'Mostly — but still tests it', key: 'knowsRule:mostly' },
        { label: 'Still learning', key: 'knowsRule:learning' },
        { label: 'No — not yet', key: 'knowsRule:no' }
      ]);
      return;
    }

    if (!p.verbalCue) {
      const prompt = p.knowsRule === 'learning'
        ? `${petNameOr('Your pet')} is still learning. When you correct the behavior now, do they respond to your voice or a familiar verbal cue?`
        : `When you use your normal verbal cue or correction for this behavior, does ${petNameOr('your pet')} understand what you mean?`;
      assistant(prompt);
      renderChoices([
        { label: 'Yes — clearly', key: 'verbalCue:yes' },
        { label: 'Usually', key: 'verbalCue:usually' },
        { label: 'Sometimes', key: 'verbalCue:sometimes' },
        { label: 'No / no verbal cue yet', key: 'verbalCue:no' }
      ]);
      return;
    }

    if (!p.whenOccurs && p.knowsRule !== 'no') {
      assistant(`When is ${petNameOr('your pet')} most likely to do this?`);
      renderChoices([
        { label: 'Mostly when I’m away or not watching', key: 'whenOccurs:unobserved' },
        { label: 'Both when I’m there and away', key: 'whenOccurs:both' },
        { label: 'Mostly when I’m there', key: 'whenOccurs:observed' },
        { label: 'Not sure', key: 'whenOccurs:unknown' }
      ]);
      return;
    }

    if (needsLocationCheck(p.currentBehavior) && !p.predictableLocation) {
      assistant('Can the behavior usually be narrowed to one place or a few predictable places where ChatrBox could be aimed?');
      renderChoices([
        { label: 'Yes — one specific place', key: 'predictableLocation:yes' },
        { label: 'Yes — a few predictable places', key: 'predictableLocation:few' },
        { label: 'No — it happens almost anywhere', key: 'predictableLocation:no' },
        { label: 'Not sure', key: 'predictableLocation:unknown' }
      ]);
      return;
    }

    if (p.multiPet === 'yes' && !p.targetable) {
      assistant('Because there are other pets in the home, could ChatrBox be positioned so it mainly detects the problem activity — for example on the couch rather than normal movement on the floor?');
      renderChoices([
        { label: 'Yes — I can isolate the activity', key: 'targetable:yes' },
        { label: 'Probably', key: 'targetable:probably' },
        { label: 'No — other pets would trigger it too', key: 'targetable:no' },
        { label: 'Not sure', key: 'targetable:unknown' }
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
        mode: 'training_first',
        summary: `${name} does not yet appear to have an established rule or meaningful verbal cue for this behavior.`,
        why: 'ChatrBox works best when it reinforces something the pet already understands rather than trying to create meaning from a brand-new recorded correction.',
        steps: [
          'Teach the rule directly while you are present.',
          'Pair the rule with a consistent word or phrase your pet recognizes.',
          'Once the response becomes meaningful, reassess ChatrBox for reinforcement.'
        ]
      };
    }

    if (p.knowsRule === 'learning' && ['yes', 'usually', 'sometimes'].includes(p.verbalCue)) {
      return {
        fit: 'Potential Fit — Pre-Training Recommended',
        mode: 'wifi_pretraining',
        summary: `${name} is still learning the rule, but already responds to your voice. ChatrBox can potentially help during that learning process.`,
        why: 'Start with Wi-Fi/manual control so you can trigger the familiar recorded correction at the right moment while you supervise. Once the rule is established, transition to automatic operation.',
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
    else if (p.knowsRule === 'mostly') score += 2;
    else if (p.knowsRule === 'no') score -= 3;

    if (['yes', 'usually'].includes(p.verbalCue)) score += 3;
    else if (p.verbalCue === 'sometimes') score += 1;
    else if (p.verbalCue === 'no') score -= 3;

    if (p.whenOccurs === 'unobserved') score += 3;
    else if (p.whenOccurs === 'both') score += 1;

    if (!needsLocationCheck(p.currentBehavior)) score += 2;
    else if (['yes', 'few'].includes(p.predictableLocation)) score += 2;
    else if (p.predictableLocation === 'no') score -= 2;

    if (p.targetable === 'yes') score += 1;
    else if (p.targetable === 'no') score -= 2;

    const strong = score >= 7;
    return {
      fit: strong ? 'Strong Fit' : 'Potential Fit',
      mode: strong ? 'automatic' : 'conditional',
      summary: strong
        ? `${name} shows several of the strongest indicators for ChatrBox: an understood rule, a meaningful verbal correction, and a situation that can be targeted for reinforcement.`
        : `${name} has some positive ChatrBox indicators, but setup, repetition, or additional training may play a larger role in the outcome.`,
      why: p.whenOccurs === 'unobserved'
        ? 'A particularly positive sign is that the behavior happens mainly when you are away or not watching — exactly when ChatrBox can extend a familiar correction beyond your physical presence.'
        : 'ChatrBox may be able to reinforce the familiar rule at the moment the behavior occurs, but results will depend more heavily on detection, placement, and how meaningful the recorded cue already is.',
      steps: [
        'Position ChatrBox so its detection area is focused on the problem activity.',
        'Record the same familiar word or correction your pet already understands.',
        'Let ChatrBox deliver that familiar correction when the behavior occurs.',
        'Use consistent placement and repetition; behavior change may take time.'
      ]
    };
  }

  function renderChoices(items) {
    const wrap = document.createElement('div');
    wrap.className = 'cbfit-chips';
    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cbfit-chip';
      button.textContent = item.label;
      button.addEventListener('click', () => {
        Array.from(wrap.querySelectorAll('button')).forEach((b) => { b.disabled = true; });
        const value = item.value || item.label;
        user(value);
        processInput(value, item.key || null);
      });
      wrap.appendChild(button);
    });
    qs('#cbfit-thread').appendChild(wrap);
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderResult(result) {
    state.complete = true;
    setProgress(100);
    assistant(result.why || 'Based on what you told us, here’s our assessment.');

    const card = document.createElement('div');
    card.className = 'cbfit-result';
    const name = petNameOr('your pet');
    const howHeading = result.mode === 'not_recommended'
      ? 'What we recommend instead'
      : `How ChatrBox could work for ${name}`;

    card.innerHTML = `
      <div class="cbfit-result-top">
        <div class="cbfit-result-label">ChatrBox recommendation</div>
        <h3>${escapeHtml(result.fit)}</h3>
        <p>${escapeHtml(result.summary || '')}</p>
      </div>
      <div class="cbfit-result-body">
        <h4>${escapeHtml(howHeading)}</h4>
        <ol>${(result.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
        <div class="cbfit-note"><strong>What to expect:</strong> ChatrBox is a reinforcement tool. Proper setup, repetition, existing training, and the individual pet can affect results. No particular behavioral result is guaranteed.</div>
        <div class="cbfit-cta-row">
          ${result.mode === 'not_recommended' ? '' : `<a class="cbfit-primary" href="${escapeAttr(withAssessmentId(PRODUCT_URL))}" data-cbfit-product>See how ChatrBox works</a>`}
          <button class="cbfit-secondary" type="button" data-cbfit-restart>Assess another behavior</button>
        </div>
      </div>`;

    qs('#cbfit-thread').appendChild(card);
    qs('#cbfit-composer').classList.add('cbfit-hidden');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    card.querySelector('[data-cbfit-product]')?.addEventListener('click', () => {
      track('fit_result_cta', { fit: result.fit, mode: result.mode });
    });
    card.querySelector('[data-cbfit-restart]').addEventListener('click', restart);
    track('fit_assessment_completed', { fit: result.fit, mode: result.mode });
  }

  function restart() {
    state.assessmentId = newAssessmentId();
    writeCookie('petitek_fit_assessment_id', state.assessmentId, 14);
    state.turn = 0;
    state.complete = false;
    state.profile = blankProfile();
    qs('#cbfit-thread').innerHTML = '';
    qs('#cbfit-composer').classList.remove('cbfit-hidden');
    startConversation();
  }

  function assistant(text) { bubble('assistant', text); }
  function user(text) { bubble('user', text); }

  function bubble(role, text) {
    const row = document.createElement('div');
    row.className = `cbfit-msg ${role}`;
    const message = document.createElement('div');
    message.className = 'cbfit-bubble';
    message.textContent = text;
    row.appendChild(message);
    qs('#cbfit-thread').appendChild(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setBusy(on) {
    qs('#cbfit-send').disabled = on;
    qs('#cbfit-textarea').disabled = on;
  }

  function setProgress(percent) {
    qs('#cbfit-progress-bar').style.width = `${Math.max(6, Math.min(100, percent))}%`;
  }

  function needsLocationCheck(type) {
    return ['marking', 'scratching', 'other_location_action', 'unpredictable_behavior', 'other'].includes(type);
  }

  function petNameOr(fallback) { return state.profile.petName || fallback; }

  function getOrCreateAssessmentId() {
    const existing = readCookie('petitek_fit_assessment_id');
    if (existing) return existing;
    const id = newAssessmentId();
    writeCookie('petitek_fit_assessment_id', id, 14);
    return id;
  }

  function newAssessmentId() {
    if (window.crypto?.randomUUID) return `FA_${window.crypto.randomUUID()}`;
    return `FA_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  }

  function withAssessmentId(url) {
    if (!url || url === '#') return '#';
    try {
      const target = new URL(url, window.location.href);
      target.searchParams.set('fit_assessment_id', state.assessmentId);
      return target.toString();
    } catch (_) {
      return url;
    }
  }

  function readCookie(name) {
    const escaped = name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function writeCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  }

  function track(eventName, params) {
    const payload = Object.assign({ assessment_id: state.assessmentId, fit_version: '2' }, params || {});
    if (typeof window.gtag === 'function') window.gtag('event', eventName, payload);
    window.dispatchEvent(new CustomEvent('chatrbox-fit-event', { detail: { event: eventName, ...payload } }));
  }

  function qs(selector) { return document.querySelector(selector); }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function escapeAttr(value) { return escapeHtml(value); }
})();