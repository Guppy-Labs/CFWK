import { clearAccountUserBootstrapCache } from './utils/accountBootstrapCache';

type AdminUser = {
    permissions?: string[];
};

type NewsPost = {
    _id: string;
    title: string;
    content: string;
    classification: 'RELEASE' | 'OTHER';
    imageUrl?: string;
    authorUsernameSnapshot?: string;
    publishAt?: string;
    createdAt?: string;
};

type NewsListResponse = {
    posts: NewsPost[];
};

const forbiddenBox = document.getElementById('forbidden') as HTMLDivElement;
const appLayout = document.getElementById('app-layout') as HTMLElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const newPostBtn = document.getElementById('new-post-btn') as HTMLButtonElement;
const postsMeta = document.getElementById('posts-meta') as HTMLParagraphElement;
const postsList = document.getElementById('posts-list') as HTMLDivElement;
const editor = document.getElementById('editor') as HTMLDivElement;
const editorTitle = document.getElementById('editor-title') as HTMLHeadingElement;
const form = document.getElementById('post-form') as HTMLFormElement;
const titleInput = document.getElementById('title-input') as HTMLInputElement;
const contentInput = document.getElementById('content-input') as HTMLTextAreaElement;
const classificationInput = document.getElementById('classification-input') as HTMLSelectElement;
const authorInput = document.getElementById('author-input') as HTMLInputElement;
const publishInput = document.getElementById('publish-input') as HTMLInputElement;
const imageInput = document.getElementById('image-input') as HTMLInputElement;
const removeImageInput = document.getElementById('remove-image-input') as HTMLInputElement;
const existingImageLabel = document.getElementById('existing-image-label') as HTMLSpanElement;
const formFeedback = document.getElementById('form-feedback') as HTMLParagraphElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;

let isAdmin = false;
let posts: NewsPost[] = [];
let editingPostId: string | null = null;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(raw?: string): string {
    if (!raw) return 'No date';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'No date';
    return date.toLocaleString();
}

function toDateTimeLocal(raw?: string): string {
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localTime.toISOString().slice(0, 16);
}

function showForbidden() {
    appLayout.style.display = 'none';
    forbiddenBox.classList.add('show');
}

function openEditor(post?: NewsPost) {
    editor.classList.add('show');
    formFeedback.textContent = '';

    if (!post) {
        editingPostId = null;
        editorTitle.textContent = 'Create Post';
        titleInput.value = '';
        contentInput.value = '';
        classificationInput.value = 'RELEASE';
        authorInput.value = '';
        publishInput.value = '';
        imageInput.value = '';
        removeImageInput.checked = false;
        existingImageLabel.textContent = '';
        return;
    }

    editingPostId = post._id;
    editorTitle.textContent = 'Edit Post';
    titleInput.value = post.title;
    contentInput.value = post.content;
    classificationInput.value = post.classification;
    authorInput.value = post.authorUsernameSnapshot || '';
    publishInput.value = toDateTimeLocal(post.publishAt);
    imageInput.value = '';
    removeImageInput.checked = false;
    existingImageLabel.textContent = post.imageUrl ? `Current image: ${post.imageUrl}` : 'No image attached';
}

function closeEditor() {
    editor.classList.remove('show');
    editingPostId = null;
    formFeedback.textContent = '';
}

function renderPosts() {
    const sorted = [...posts].sort((a, b) => {
        const aTime = new Date(a.publishAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.publishAt || b.createdAt || 0).getTime();
        return bTime - aTime;
    });

    if (sorted.length === 0) {
        postsMeta.textContent = 'No posts yet';
        postsList.innerHTML = '<div class="post-row">No posts have been created yet.</div>';
        return;
    }

    postsMeta.textContent = `${sorted.length} post${sorted.length === 1 ? '' : 's'}`;
    postsList.innerHTML = sorted.map((post) => {
        const displayDate = post.publishAt || post.createdAt;
        const releaseClass = post.classification === 'RELEASE' ? 'release' : '';
        const imageHtml = post.imageUrl
            ? `<img class="post-image" src="${escapeHtml(post.imageUrl)}" alt="Image for ${escapeHtml(post.title)}">`
            : '';
        const authorText = post.authorUsernameSnapshot ? ` | by ${escapeHtml(post.authorUsernameSnapshot)}` : '';

        return `
            <article class="post-row ${releaseClass}">
                <div class="post-head">
                    <h3 class="post-title">${escapeHtml(post.title)}</h3>
                    <span class="post-meta">${escapeHtml(post.classification)} | ${escapeHtml(formatDate(displayDate))}${authorText}</span>
                </div>
                <p class="post-content">${escapeHtml(post.content)}</p>
                ${imageHtml}
                <div class="post-actions">
                    <button class="mm-btn mm-btn-secondary" data-action="edit" data-post-id="${escapeHtml(post._id)}"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="mm-btn mm-btn-danger" data-action="delete" data-post-id="${escapeHtml(post._id)}"><i class="fa-solid fa-trash"></i> Delete</button>
                </div>
            </article>
        `;
    }).join('');
}

async function loadPosts() {
    const res = await fetch('/api/news', { credentials: 'include' });
    if (!res.ok) {
        postsMeta.textContent = 'Failed to load posts';
        postsList.innerHTML = '<div class="post-row">Could not load posts.</div>';
        return;
    }
    const payload = await res.json() as NewsListResponse;
    posts = Array.isArray(payload.posts) ? payload.posts : [];
    renderPosts();
}

async function savePost() {
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    const classification = classificationInput.value;
    const author = authorInput.value.trim();
    const publishAt = publishInput.value.trim();

    if (!title || !content) {
        formFeedback.textContent = 'Title and content are required.';
        return;
    }
    if (classification !== 'RELEASE' && classification !== 'OTHER') {
        formFeedback.textContent = 'Classification must be RELEASE or OTHER.';
        return;
    }

    const method = editingPostId ? 'PUT' : 'POST';
    const endpoint = editingPostId ? `/api/news/${editingPostId}` : '/api/news';
    const body = new FormData();
    body.append('title', title);
    body.append('content', content);
    body.append('classification', classification);
    if (author) body.append('author', author);
    if (publishAt) {
        const isoDate = new Date(publishAt).toISOString();
        body.append('publishAt', isoDate);
    }
    if (imageInput.files && imageInput.files[0]) {
        body.append('image', imageInput.files[0]);
    }
    if (editingPostId && removeImageInput.checked) {
        body.append('removeImage', 'true');
    }

    saveBtn.disabled = true;
    formFeedback.textContent = 'Saving...';
    try {
        const res = await fetch(endpoint, {
            method,
            body,
            credentials: 'include'
        });
        const data = await res.json() as { message?: string };
        if (!res.ok) {
            formFeedback.textContent = data.message || 'Failed to save post.';
            return;
        }

        closeEditor();
        await loadPosts();
    } catch {
        formFeedback.textContent = 'Failed to save post.';
    } finally {
        saveBtn.disabled = false;
    }
}

async function deletePost(postId: string) {
    const confirmed = window.confirm('Delete this post? This cannot be undone.');
    if (!confirmed) return;

    const res = await fetch(`/api/news/${postId}`, {
        method: 'DELETE',
        credentials: 'include'
    });
    if (!res.ok) {
        window.alert('Failed to delete post.');
        return;
    }
    await loadPosts();
}

postsList.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const actionEl = target.closest('[data-action]') as HTMLElement | null;
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const postId = actionEl.dataset.postId;
    if (!action || !postId) return;

    if (action === 'edit') {
        const post = posts.find((entry) => entry._id === postId);
        if (post) openEditor(post);
        return;
    }
    if (action === 'delete') {
        await deletePost(postId);
    }
});

newPostBtn.addEventListener('click', () => openEditor());
cancelBtn.addEventListener('click', () => closeEditor());
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await savePost();
});

logoutBtn.addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
        clearAccountUserBootstrapCache();
        window.location.href = '/login';
    }
});

async function init() {
    const authRes = await fetch('/api/auth/me', { credentials: 'include' });
    if (!authRes.ok) {
        clearAccountUserBootstrapCache();
        window.location.href = '/login';
        return;
    }

    const authPayload = await authRes.json() as { user?: AdminUser };
    const permissions = Array.isArray(authPayload.user?.permissions) ? authPayload.user?.permissions : [];
    isAdmin = permissions.includes('game.admin');
    if (!isAdmin) {
        showForbidden();
        return;
    }

    await loadPosts();
}

void init().catch(() => {
    showForbidden();
});

export {};
