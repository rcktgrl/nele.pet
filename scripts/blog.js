/**
 * Fetch and render lightweight blog entries stored in blog.json. The UI keeps
 * messaging friendly so the blog page does not feel empty while loading or on
 * errors.
 */
const blogPostsContainer = document.getElementById('blog-posts');

if (blogPostsContainer) {
  const renderStatus = (message) => {
    blogPostsContainer.innerHTML = `<p class="empty-state">${message}</p>`;
  };

  const renderPosts = (posts) => {
    blogPostsContainer.innerHTML = '';

    posts.slice().reverse().forEach((post) => {
      const entry = document.createElement('div');
      entry.className = 'blog-entry';

      const linkHTML = post.link && post.linkText
        ? `<p><a href="${post.link}" target="_blank" rel="noopener">${post.linkText}</a></p>`
        : '';

      entry.innerHTML = `
        <p><strong>${post.date}:</strong> ${post.content}</p>
        ${linkHTML}
      `;

      blogPostsContainer.appendChild(entry);
    });
  };

  const fetchPosts = async () => {
    try {
      const response = await fetch('blog.json');
      if (!response.ok) {
        throw new Error('Blog posts could not be fetched');
      }

      const posts = await response.json();
      if (!Array.isArray(posts) || posts.length === 0) {
        renderStatus('No blog posts yet.');
        return;
      }

      renderPosts(posts);
    } catch (error) {
      console.error(error);
      renderStatus('Could not load blog posts. Please try again later.');
    }
  };

  renderStatus('Loading posts…');
  fetchPosts();
}
