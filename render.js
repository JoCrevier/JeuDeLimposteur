import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PALETTE,
  THEMES,
  THEME_LIST,
  TURN_SECONDS,
  normalizeThemeId
} from "./game.js";

import {
  startTurnTimer,
  stopTurnTimer,
  startVoteTimer,
  stopVoteTimer,
  setTurnStatusText
} from "./timers.js";

import { updateGameSessionCodeDisplay } from "./sessionManager.js";

let ctx = null; // { state, dom, callbacks }

export function initRender(context) {
  ctx = context;
}

export function showScreen(name) {
  Object.values(ctx.dom.screens).forEach((s) => s.classList.remove("active"));
  ctx.dom.screens[name].classList.add("active");
  if (name === "game") {
    updateGameSessionCodeDisplay(ctx.state.sessionCode);
  }
}

export function showError(el, msg) {
  el.textContent = msg;
  el.classList.add("visible");
}

export function hideError(el) {
  el.textContent = "";
  el.classList.remove("visible");
}

export function renderCounter(players) {
  const { playerCountText, statusDot, minPlayersNotice } = ctx.dom;
  const count = players.length;
  playerCountText.textContent = `${count} / ${MAX_PLAYERS} ${count > 1 ? "joueurs" : "joueur"}`;
  const enough = count >= MIN_PLAYERS;
  statusDot.classList.toggle("ready", enough);

  if (minPlayersNotice) {
    if (count < MIN_PLAYERS) {
      const missing = MIN_PLAYERS - count;
      minPlayersNotice.textContent = `En attente de ${missing} ${missing > 1 ? "joueurs" : "joueur"} minimum`;
      minPlayersNotice.style.color = "var(--warning)";
    } else {
      const readyCount = players.filter((p) => p.ready).length;
      minPlayersNotice.textContent = `${readyCount} / ${count} joueurs prêts`;
      minPlayersNotice.style.color = readyCount === count ? "var(--success)" : "var(--accent)";
    }
  }
}

export function renderThemeSelector() {
  const { themeGrid, themeHint } = ctx.dom;
  const canPickTheme = ctx.callbacks.isCurrentUserHost();
  const activeTheme = THEMES[normalizeThemeId(ctx.state.selectedThemeId)];

  themeHint.textContent = canPickTheme
    ? `Thème actif : ${activeTheme.label} (clique pour changer)`
    : `Thème choisi par l'hôte : ${activeTheme.label}`;

  themeGrid.innerHTML = "";
  THEME_LIST.forEach((theme) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-btn" + (theme.id === ctx.state.selectedThemeId ? " active" : "");
    btn.textContent = theme.label;
    btn.disabled = !canPickTheme;

    btn.addEventListener("click", () => ctx.callbacks.selectSessionTheme(theme.id));
    themeGrid.appendChild(btn);
  });
}

export function renderColorPicker() {
  const { colorsGrid } = ctx.dom;
  const state = ctx.state;
  const takenColors = new Set(state.players.map((p) => p.color));
  colorsGrid.innerHTML = "";

  PALETTE.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-btn";
    btn.style.backgroundColor = c.hex;
    btn.title = c.name;
    const isTaken = takenColors.has(c.hex);

    if (isTaken) {
      btn.classList.add("taken");
      btn.disabled = true;
    } else if (state.selectedColor === c.hex) {
      btn.classList.add("selected");
    }

    btn.addEventListener("click", () => {
      if (isTaken) return;
      state.selectedColor = c.hex;
      hideError(ctx.dom.profileError);
      renderColorPicker();
    });

    colorsGrid.appendChild(btn);
  });
}

export function renderLobby() {
  const { dom, state } = ctx;
  renderCounter(state.players);
  renderThemeSelector();

  const amHost = ctx.callbacks.isCurrentUserHost();
  dom.hostControls.classList.toggle("hidden", !amHost);
  dom.kickAllBtn.disabled = state.players.length <= 1;

  const me = state.players.find((p) => p.id === state.playerId);
  if (me) {
    dom.toggleReadyBtn.textContent = me.ready ? "Annuler « Prêt »" : "Je suis prêt";
    dom.toggleReadyBtn.className = me.ready ? "btn-secondary" : "btn-success";
  }

  dom.playersGrid.innerHTML = "";
  state.players.forEach((p) => {
    const card = document.createElement("div");
    card.className = "player-card" + (p.ready ? " is-ready" : "");

    const left = document.createElement("div");
    left.className = "player-left";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.backgroundColor = p.color;
    avatar.textContent = p.name.charAt(0).toUpperCase();

    const info = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "player-name";
    nameEl.textContent = p.name;

    const tags = [];
    if (p.id === state.hostId) tags.push("Hôte ★");
    tags.push(p.id === state.playerId ? "Toi" : "Connecté");

    const tagEl = document.createElement("div");
    tagEl.className = "player-tag";
    tagEl.textContent = tags.join(" • ");

    info.append(nameEl, tagEl);
    left.append(avatar, info);

    const readyPill = document.createElement("span");
    readyPill.className = "ready-pill" + (p.ready ? " ready" : "");
    readyPill.textContent = p.ready ? "Prêt ✓" : "En attente";

    card.append(left, readyPill);
    dom.playersGrid.appendChild(card);
  });
}

export function renderGame() {
  const { dom, state } = ctx;
  const game = state.game;
  if (!game) return;

  updateGameSessionCodeDisplay(state.sessionCode);
  renderCounter(state.players);
  const themeLabel = game.themeLabel || THEMES[normalizeThemeId(state.selectedThemeId)].label;
  dom.roundDisplay.textContent = `Manche ${game.round || 1} • Thème : ${themeLabel}`;

  const me = state.players.find((p) => p.id === state.playerId);
  const amImpostor = game.impostorId === state.playerId;
  const amEliminated = Boolean(me?.eliminated);

  if (amImpostor) {
    dom.roleBanner.className = "role-card impostor";
    dom.roleBanner.textContent = "Rôle : IMPOSTEUR • Mot secret caché — devine-le !";
  } else {
    dom.roleBanner.className = "role-card detective";
    dom.roleBanner.textContent = `Mot secret : ${game.secretWord} • Enquêteur`;
  }

  dom.phaseWriteView.classList.add("hidden");
  dom.phaseDiscussView.classList.add("hidden");
  dom.phaseVoteView.classList.add("hidden");
  dom.phaseResultView.classList.add("hidden");

  const activePlayers = state.players.filter((p) => !p.eliminated);
  const order = Array.isArray(game.turnOrder) ? game.turnOrder : [];
  const currentTurnIdx = game.currentTurnIndex || 0;
  const activeTurnPlayerId = order[currentTurnIdx] || null;
  const activeTurnPlayer = state.players.find((p) => p.id === activeTurnPlayerId);
  const isMyTurn = activeTurnPlayerId === state.playerId && !amEliminated;

  if (game.phase === "write") {
    stopVoteTimer();
    dom.phaseTitle.textContent = `Phase 1 / 3 : Écriture (${Math.min(currentTurnIdx + 1, order.length)} / ${order.length})`;
    dom.phaseWriteView.classList.remove("hidden");

    const turnName = activeTurnPlayer
      ? activeTurnPlayer.id === state.playerId
        ? "C'est ton tour !"
        : `Tour de ${activeTurnPlayer.name}`
      : "Préparation du tour...";
    setTurnStatusText(turnName);
    startTurnTimer(game);

    const completedTurns = order.filter((id) => Boolean(game.words && id in game.words)).length;

    if (amEliminated) {
      dom.writeInstruction.textContent = "Tu as été éliminé. Observe les tours des joueurs restants.";
      dom.wordForm.classList.add("hidden");
      dom.wordInput.disabled = true;
      dom.submitWordBtn.disabled = true;
    } else if (isMyTurn) {
      dom.wordForm.classList.remove("hidden");
      dom.wordInput.disabled = false;
      dom.submitWordBtn.disabled = false;
      dom.writeInstruction.textContent = amImpostor
        ? `Thème « ${themeLabel} » : tu ne vois pas le mot secret. Devinez-le à partir des indices et écris un mot en moins de ${TURN_SECONDS}s !`
        : `Le mot secret est « ${game.secretWord} » (thème ${themeLabel}). Écris un indice en moins de ${TURN_SECONDS}s :`;
      if (document.activeElement !== dom.wordInput) {
        dom.wordInput.focus();
      }
    } else {
      dom.wordForm.classList.add("hidden");
      dom.wordInput.disabled = true;
      dom.submitWordBtn.disabled = true;
      dom.writeInstruction.textContent = amImpostor
        ? `Attends que ${activeTurnPlayer?.name || "le joueur"} écrive son mot pour t'aider à deviner le mot secret...`
        : `Attends que ${activeTurnPlayer?.name || "le joueur"} écrive son mot (max ${TURN_SECONDS}s).`;
    }

    dom.writeProgressText.textContent = `${completedTurns} / ${order.length} tours terminés.`;
  } else {
    stopTurnTimer();
  }

  if (game.phase === "discuss") {
    stopVoteTimer();
    dom.phaseTitle.textContent = "Phase 2 / 3 : Délibération";
    dom.phaseDiscussView.classList.remove("hidden");

    dom.wordsList.innerHTML = "";
    activePlayers.forEach((p) => {
      const card = document.createElement("div");
      card.className = "word-item";

      const header = document.createElement("div");
      header.className = "word-item-header";

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.backgroundColor = p.color;

      const nameSpan = document.createElement("span");
      nameSpan.textContent = p.name + (p.id === state.playerId ? " (Toi)" : "");

      header.append(dot, nameSpan);

      const submittedWord = game.words && p.id in game.words ? game.words[p.id] : null;
      const wordVal = document.createElement("div");
      if (submittedWord) {
        wordVal.className = "word-value";
        wordVal.textContent = submittedWord;
      } else {
        wordVal.className = "word-value missed";
        wordVal.textContent = "Aucun mot (temps écoulé)";
      }

      card.append(header, wordVal);
      dom.wordsList.appendChild(card);
    });

    dom.goToVoteBtn.disabled = amEliminated;
  }

  if (game.phase === "vote") {
    dom.phaseTitle.textContent = "Phase 3 / 3 : Vote d'exclusion";
    dom.phaseVoteView.classList.remove("hidden");
    startVoteTimer(game);

    const myVote = game.votes?.[state.playerId] || null;
    const votedCount = activePlayers.filter((p) => Boolean(game.votes?.[p.id])).length;

    dom.voteGrid.innerHTML = "";
    activePlayers.forEach((target) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vote-btn" + (myVote === target.id ? " voted" : "");
      btn.disabled = amEliminated || target.id === state.playerId;

      const left = document.createElement("div");
      left.className = "player-left";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.style.backgroundColor = target.color;
      avatar.textContent = target.name.charAt(0).toUpperCase();

      const wordLabel =
        game.words && target.id in game.words && game.words[target.id]
          ? game.words[target.id]
          : "Aucun mot";

      const label = document.createElement("span");
      label.textContent = `${target.name} (${wordLabel})`;

      left.append(avatar, label);

      const badge = document.createElement("span");
      badge.className = "player-tag";
      badge.textContent = myVote === target.id ? "Ton vote ✓" : "Voter";

      btn.append(left, badge);
      btn.addEventListener("click", () => ctx.callbacks.castVote(target.id));
      dom.voteGrid.appendChild(btn);
    });

    dom.voteProgressText.textContent = `${votedCount} / ${activePlayers.length} joueurs ont voté (vote nul si personne ne vote avant la fin du chrono).`;
  } else {
    stopVoteTimer();
  }

  if (game.phase === "result" || game.phase === "finished") {
    stopVoteTimer();
    dom.phaseTitle.textContent = game.phase === "finished" ? "Fin de la partie" : "Résultat du vote";
    dom.phaseResultView.classList.remove("hidden");
    dom.resultBanner.textContent = game.lastResult?.message || "Manche terminée.";

    dom.nextRoundBtn.textContent =
      game.phase === "finished" ? "Retour au salon" : "Manche suivante";
  }
}