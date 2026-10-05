// Projectへの振り分け（Projectの選択と追加先のフォーム）。
import { readApiJson } from "../api-client.js";
import { viewMeta } from "./constants.js";
import { loadDashboard } from "./data.js";
import { hideDrawer, renderDrawerItem } from "./drawer.js";
import { inboxExpected, routeInboxViaApi } from "./edit-forms.js";
import { escapeHtml, setDrawerTitle, showToast, sourceTextMarkup, splitInboxSource } from "./format.js";
import { syncCompassRoute } from "./list.js";
import { triageCompletionNote, triageKicker, triageSourceLabel } from "./route.js";
import { els, state } from "./state.js";

function projectSourceSnapshot(item, view) {
  return {
    type: view === "inbox" ? "inbox" : "want",
    id: item.id,
    content: item.content,
    status: item.status,
    result: view === "inbox" ? item.result ?? null : null,
  };
}

export async function startProjectRoute(item, view) {
  const requestToken = ++state.aiRequestToken;
  state.triageSource = view;
  els.drawerKicker.textContent = triageKicker(item, view);
  setDrawerTitle("Projectとして進める");
  els.drawerBody.innerHTML = `<div class="source-context"><span>${escapeHtml(triageSourceLabel(view))}</span>${sourceTextMarkup(item.content)}</div>
    <div class="ai-loading" role="status"><span aria-hidden="true"></span><p>Projectを確認しています…</p></div>`;

  try {
    const response = await fetch("/api/projects", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    const message = typeof payload.error === "string" ? payload.error : "Projectを読み込めませんでした。";
    if (!response.ok || !Array.isArray(payload.projects)) throw new Error(message);
    if (requestToken !== state.aiRequestToken) return;
    renderProjectRouteForm(item, view, payload.projects.filter((project) => !["completed", "dropped"].includes(project.status)));
  } catch (error) {
    if (requestToken !== state.aiRequestToken) return;
    els.drawerBody.innerHTML = `<div class="source-context"><span>${escapeHtml(triageSourceLabel(view))}</span>${sourceTextMarkup(item.content)}</div>
      <div class="integration-status error"><strong>Projectを確認できませんでした</strong><span>${escapeHtml(error instanceof Error ? error.message : "時間をおいて再試行してください。")}</span></div>
      <div class="drawer-actions"><button class="secondary-action" id="cancelProjectRoute" type="button">戻る</button><button class="primary-action" id="retryProjectRoute" type="button">再試行</button></div>`;
    document.getElementById("cancelProjectRoute").addEventListener("click", () => renderDrawerItem(item, view));
    document.getElementById("retryProjectRoute").addEventListener("click", () => startProjectRoute(item, view));
  }
}

function renderProjectRouteForm(item, view, projects) {
  const title = splitInboxSource(item.content).body.slice(0, 240);
  const options = projects.map((project) => {
    const action = project.nextAction?.content || "Next Action要確認";
    return `<option value="${project.id}">${escapeHtml(project.title)} — ${escapeHtml(action)}</option>`;
  }).join("");
  els.drawerBody.innerHTML = `<form class="edit-form project-route-form" id="projectRouteForm">
    <div class="source-context"><span>${escapeHtml(triageSourceLabel(view))}</span>${sourceTextMarkup(item.content)}</div>
    <p class="route-boundary">元のデータは消さずにProjectへリンクし、${escapeHtml(triageCompletionNote(view))}</p>
    <fieldset class="project-mode-options">
      <legend>整理先</legend>
      <label><input type="radio" name="projectMode" value="create" checked /> 新しいProjectを作る</label>
      <label><input type="radio" name="projectMode" value="link" ${projects.length ? "" : "disabled"} /> 既存のProjectへ入れる</label>
    </fieldset>
    <div class="project-mode-section" data-project-mode-section="create">
      <label class="form-field"><span>Project名 <b>必須</b></span><input name="projectTitle" type="text" maxlength="240" value="${escapeHtml(title)}" required /></label>
      <label class="form-field"><span>完了条件 <b>必須</b></span><textarea name="projectOutcome" maxlength="2000" rows="3" placeholder="何ができたら、このProjectは完了ですか？" required></textarea></label>
      <label class="form-field"><span>最初のNext Action <b>必須</b></span><textarea name="projectNextAction" maxlength="500" rows="2" placeholder="目で見て着手できる、次の具体的な一手" required></textarea></label>
      <div class="project-optional-fields">
        <label class="form-field"><span>テーマ</span><input name="projectTheme" type="text" maxlength="120" placeholder="任意" /></label>
        <label class="form-field"><span>目標日</span><input name="projectTargetOn" type="date" /></label>
      </div>
    </div>
    <div class="project-mode-section" data-project-mode-section="link" hidden>
      <label class="form-field"><span>Project <b>必須</b></span><select name="projectId" ${projects.length ? "" : "disabled"}>${options || '<option value="">進行中のProjectがありません</option>'}</select></label>
      <p class="flow-note">「未整理」として追加し、Project一覧の「要確認」に表示します。現在のNext Actionは勝手に変更しません。</p>
    </div>
    <p class="form-error" id="projectRouteError" role="alert" hidden></p>
    <div class="drawer-actions"><button class="secondary-action" id="cancelProjectRoute" type="button">戻る</button><button class="primary-action" id="saveProjectRoute" type="submit">Projectへ整理</button></div>
  </form>`;

  const form = document.getElementById("projectRouteForm");
  const errorElement = document.getElementById("projectRouteError");
  const submit = document.getElementById("saveProjectRoute");
  const cancel = document.getElementById("cancelProjectRoute");
  const updateMode = () => {
    const mode = form.elements.projectMode.value;
    form.querySelectorAll("[data-project-mode-section]").forEach((section) => {
      const active = section.dataset.projectModeSection === mode;
      section.hidden = !active;
      section.querySelectorAll("input, select, textarea").forEach((field) => {
        field.disabled = !active || (field.name === "projectId" && !projects.length);
      });
    });
  };
  form.querySelectorAll('input[name="projectMode"]').forEach((radio) => radio.addEventListener("change", updateMode));
  updateMode();
  cancel.addEventListener("click", () => renderDrawerItem(item, view));
  const projectRouteKey = crypto.randomUUID();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorElement.hidden = true;
    submit.disabled = true;
    cancel.disabled = true;
    submit.textContent = "整理中…";
    const mode = form.elements.projectMode.value;
    const source = projectSourceSnapshot(item, view);
    let body;
    if (mode === "link") {
      const project = projects.find((candidate) => candidate.id === Number(form.elements.projectId.value));
      if (!project) {
        errorElement.textContent = "紐づけ先のProjectを選んでください。";
        errorElement.hidden = false;
        submit.disabled = false;
        cancel.disabled = false;
        submit.textContent = "Projectへ整理";
        return;
      }
      body = { operation: "link", source, projectId: project.id, originalProjectUpdatedAt: project.updatedAt };
    } else {
      body = {
        operation: "create",
        source,
        title: form.elements.projectTitle.value.trim(),
        outcome: form.elements.projectOutcome.value.trim(),
        theme: form.elements.projectTheme.value.trim() || null,
        targetOn: form.elements.projectTargetOn.value || null,
        nextAction: form.elements.projectNextAction.value.trim(),
      };
    }

    try {
      if (view === "inbox") {
        const params = body.operation === "link"
          ? { expected: inboxExpected(item), project_id: body.projectId, project_updated_at: body.originalProjectUpdatedAt }
          : {
            expected: inboxExpected(item),
            title: body.title,
            outcome: body.outcome,
            theme: body.theme,
            target_on: body.targetOn,
            next_action: body.nextAction,
          };
        const payload = await routeInboxViaApi(item.id, body.operation === "link" ? "project_link" : "project_create", params, projectRouteKey);
        if (!Number.isSafeInteger(Number(payload.project_id))) throw new Error("Projectへ整理できませんでした。");
      } else {
        const response = await fetch("/api/project-source", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Dashboard-Action": "project-source-route",
          },
          body: JSON.stringify(body),
        });
        const payload = await readApiJson(response);
        const message = typeof payload.error === "string" ? payload.error : "Projectへ整理できませんでした。";
        if (!response.ok || !Number.isSafeInteger(Number(payload.projectId))) throw new Error(message);
      }
      hideDrawer();
      syncCompassRoute(view, null, "replace", state.metricFilter);
      const refreshed = await loadDashboard();
      showToast(refreshed
        ? `${viewMeta[view].singular}をProjectへ整理しました。Projectsで次の一手を確認できます。`
        : "Projectへの整理は完了しました。画面を再読み込みしてください。");
    } catch (error) {
      errorElement.textContent = error instanceof Error ? error.message : "Projectへ整理できませんでした。";
      errorElement.hidden = false;
    } finally {
      if (submit.isConnected) {
        submit.disabled = false;
        cancel.disabled = false;
        submit.textContent = "Projectへ整理";
      }
    }
  });
}
