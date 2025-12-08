function getIndentationLevel(element) {
  let level = 0;
  let parent = element.parentNode;
  
  while (parent && parent !== element.ownerDocument.body) {
    if (parent.tagName && (parent.tagName.toLowerCase() === 'ul' || parent.tagName.toLowerCase() === 'ol')) {
      level++;
    }
    parent = parent.parentNode;
  }
  
  return level;
}

export function sanitizeHTML(html) {
  // Create a temporary div to parse the HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // Remove all style attributes and CSS classes
  const allElements = temp.querySelectorAll('*');
  allElements.forEach(el => {
    el.removeAttribute('style');
    el.removeAttribute('class');
    el.removeAttribute('id');
  });
  
  console.log('sanitizing html', temp);

  // Convert lists to dash format based on indentation level
  const lists = temp.querySelectorAll('ul, ol');
  lists.forEach(list => {
    const level = getIndentationLevel(list);
    const indentSpaces = '  '.repeat(level); // 2 spaces per level
    
    // Convert list items to dash format
    const listItems = list.querySelectorAll('li');
    const lines = [];
    listItems.forEach(li => {
      const text = li.textContent.trim();
      if (text) {
        lines.push(indentSpaces + '- ' + text);
      }
    });
    
    // Replace the list with a p tag containing the dash-formatted text with <br> tags
    // This ensures each list item appears on a new line in contenteditable divs
    // Using <p> since it's in the allowedTags list and won't be removed
    const replacementP = document.createElement('p');
    replacementP.innerHTML = lines.join('<br>') + '<br>';
    list.parentNode.replaceChild(replacementP, list);
  });
  
  // Replace <a> tags with their href URL (just the URL, not the link)
  // Do this before removing disallowed elements so we can extract the href
  const links = temp.querySelectorAll('a');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      const textNode = document.createTextNode(href);
      link.parentNode.replaceChild(textNode, link);
    } else {
      // If no href, just unwrap the link and keep the text content
      const textNode = document.createTextNode(link.textContent);
      link.parentNode.replaceChild(textNode, link);
    }
  });
  
  // Keep only allowed HTML tags and their content
  const allowedTags = ['p', 'br', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const walker = document.createTreeWalker(
    temp,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );
  
  const elementsToRemove = [];
  let node;
  while (node = walker.nextNode()) {
    if (!allowedTags.includes(node.tagName.toLowerCase())) {
      elementsToRemove.push(node);
    }
  }
  
  // Remove disallowed elements
  elementsToRemove.forEach(el => {
    const parent = el.parentNode;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  });
  
  return temp.innerHTML;
}

function replaceSelectionWith(element, content, isHTML = false) {
  const selection = window.getSelection();
  
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    
    // Handle empty element case
    if (element && (element.innerHTML === '' || element.innerHTML === '<br>')) {
      if (isHTML) {
        element.innerHTML = content;
      } else {
        element.innerHTML = '';
        element.appendChild(content);
      }
      const newRange = document.createRange();
      newRange.selectNodeContents(element);
      newRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      // Element has content, insert at range
      if (isHTML) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        const fragment = document.createDocumentFragment();
        while (tempDiv.firstChild) {
          fragment.appendChild(tempDiv.firstChild);
        }
        range.insertNode(fragment);
        selection.collapseToEnd();
      } else {
        // For text nodes, ensure range is valid
        if (!range.startContainer || range.collapsed) {
          if (element) {
            range.selectNodeContents(element);
            range.collapse(false);
          }
        }
        range.insertNode(content);
        range.setStartAfter(content);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  } else {
    // No selection, append to element
    if (element) {
      if (isHTML) {
        element.innerHTML = content;
      } else {
        element.appendChild(content);
      }
      const newRange = document.createRange();
      newRange.selectNodeContents(element);
      newRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      // Fallback to execCommand (only for HTML)
      if (isHTML) {
        document.execCommand('insertHTML', false, content);
      }
    }
  }
}

export function sanitizePasteEvent(event) {
  console.log('paste event fired');
  const clipboardData = event.clipboardData || window.clipboardData;
  if (!clipboardData) {
    console.log('No clipboardData available');
    return; // Can't handle paste without clipboardData
  }
  
  let html = clipboardData.getData('text/html');
  let plainText = clipboardData.getData('text/plain');
  
  console.log('paste data:', { html, plainText, hasClipboardData: !!clipboardData });
  
  // Always prevent default to handle paste manually
  event.preventDefault();
  
  if (html && html.trim()) {
    // If HTML is available, sanitize it and insert manually
    console.log('html', html);
    const sanitized = sanitizeHTML(html);
    console.log('sanitized:', sanitized);
    replaceSelectionWith(event.target, sanitized, true);
  } else if (plainText && plainText.trim()) {
    // Plain text only - insert it as-is without any modifications
    // Don't convert URLs to links, don't escape HTML, just insert the text
    console.log('plainText only - inserting as plain text');
    const textNode = document.createTextNode(plainText);
    replaceSelectionWith(event.target, textNode, false);
  } else {
    console.log('No paste data found');
  }
}

