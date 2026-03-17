/**
 * blog.js
 *
 * Fetches blog entries from blog.json and renders them into the blog page.
 * Posts are displayed newest-first by reversing the array before rendering.
 *
 * While loading, and on any error, a friendly status message is shown so the
 * page never appears blank to the visitor.
 */

/** The container element that will hold all blog post cards. */
const blogPostsContainer = document.getElementById('blog-posts');

// Only run if the container is actually present on this page.
if (blogPostsContainer) {

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  /**
   * Replace the container contents with a single status paragraph.
   * Used for "Loading…" and error states.
   *
   * @param {string} message - The plain-text message to display.
   */
  function renderStatus(message) {
    blogPostsContainer.innerHTML = `<p class="empty-state">${message}</p>`;
  }

  /**
   * Render all blog posts in the container, newest first.
   * Each post gets its own card div with date, content, and an optional link.
   *
   * @param {Array<{date: string, content: string, link?: string, linkText?: string}>} posts
   */
  function renderPosts(posts) {
    blogPostsContainer.innerHTML = '';

    // The JSON stores entries oldest-first; reverse a copy to show newest first.
    const newestFirst = posts.slice().reverse();

    newestFirst.forEach((post) => {
      const entry     = document.createElement('div');
      entry.className = 'blog-entry';

      // Only include a link paragraph when both href and display text exist.
      const linkHTML = post.link && post.linkText
        ? `<p><a href="${post.link}" target="_blank" rel="noopener">${post.linkText}</a></p>`
        : '';

      entry.innerHTML = `
        <p><strong>${post.date}:</strong> ${post.content}</p>
        ${linkHTML}
      `;

      blogPostsContainer.appendChild(entry);
    });
  }

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  /**
   * Fetch blog.json, validate the response, and hand the data off to
   * renderPosts. Any network or parsing error results in a friendly message
   * rather than a silent failure.
   */
  async function fetchPosts() {
    try {
      const response = await fetch('../blog.json');

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
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  // Show a loading state immediately, then kick off the async fetch.
  renderStatus('Loading posts…');
  fetchPosts();
}
