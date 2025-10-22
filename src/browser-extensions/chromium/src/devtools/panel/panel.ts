import { ComponentDetector } from '@shared/detectors/component-detector';

// DevTools Panel logic with tree view
console.log("Blazor DevTools Panel Loaded");

interface BlazorComponent {
  id: string;
  name: string;
  file: string;
  children: BlazorComponent[];
  startElement?: HTMLElement;
  endElement?: HTMLElement;
}

class ComponentTreeBuilder {
  private components: Map<string, BlazorComponent> = new Map();

  buildTree(): BlazorComponent[] {
    // Get all components from the page
    const components = this.detectComponents();
    
    // Build parent-child relationships
    const roots: BlazorComponent[] = [];
    const componentArray = Array.from(components.values());
    
    componentArray.forEach(component => {
      component.children = [];
      
      // Find children by checking if they're nested within this component
      componentArray.forEach(potentialChild => {
        if (component.id !== potentialChild.id && 
            this.isChildOf(component, potentialChild, componentArray)) {
          // Check if this is a direct child (not grandchild)
          if (this.isDirectChild(component, potentialChild, componentArray)) {
            component.children.push(potentialChild);
          }
        }
      });
    });
    
    // Find root components (those not children of any other)
    componentArray.forEach(component => {
      let isRoot = true;
      componentArray.forEach(other => {
        if (other.children.includes(component)) {
          isRoot = false;
        }
      });
      if (isRoot) {
        roots.push(component);
      }
    });
    
    return roots;
  }

  private detectComponents(): Map<string, BlazorComponent> {
    const components = new Map<string, BlazorComponent>();
    
    chrome.devtools.inspectedWindow.eval(`
      (function() {
        const comps = [];
        const openMarkers = document.querySelectorAll('[data-blazordevtools-marker="open"]');
        const componentMap = new Map();
        
        openMarkers.forEach(openMarker => {
          const id = openMarker.getAttribute('data-blazordevtools-id');
          const closeMarker = document.querySelector('[data-blazordevtools-marker="close"][data-blazordevtools-id="' + id + '"]');
          
          if (closeMarker) {
            componentMap.set(id, {
              id: id,
              name: openMarker.getAttribute('data-blazordevtools-component') || 'Unknown',
              file: openMarker.getAttribute('data-blazordevtools-file') || '',
              openIndex: Array.from(document.querySelectorAll('*')).indexOf(openMarker),
              closeIndex: Array.from(document.querySelectorAll('*')).indexOf(closeMarker),
              children: []
            });
          }
        });
        
        return Array.from(componentMap.values());
      })()
    `, (result: any) => {
      if (result && Array.isArray(result)) {
        result.forEach(comp => {
          components.set(comp.id, comp);
        });
      }
    });
    
    return components;
  }

  private isChildOf(parent: any, child: any, allComponents: any[]): boolean {
    // Child is nested if its open marker comes after parent's open and before parent's close
    return child.openIndex > parent.openIndex && child.closeIndex < parent.closeIndex;
  }

  private isDirectChild(parent: any, child: any, allComponents: any[]): boolean {
    // Check if there's any intermediate parent
    for (const comp of allComponents) {
      if (comp.id !== parent.id && comp.id !== child.id) {
        if (this.isChildOf(parent, comp, allComponents) && this.isChildOf(comp, child, allComponents)) {
          return false; // Found intermediate parent
        }
      }
    }
    return true;
  }
}

// Display components in tree format
// Update the displayComponentTree function
function displayComponentTree(container: HTMLElement, components: BlazorComponent[], level: number = 0) {
  components.forEach(component => {
    // Opening tag
    const div = document.createElement('div');
    div.className = 'component-item';
    div.style.paddingLeft = `${level * 20}px`;
    
    const hasChildren = component.children && component.children.length > 0;
    
    const componentHtml = hasChildren 
      ? `<span class="component-tag">&lt;<span class="component-name">${component.name}</span>&gt;</span>`
      : `<span class="component-tag">&lt;<span class="component-name">${component.name}</span> /&gt;</span>`;
    
    div.innerHTML = componentHtml;
    div.setAttribute('title', component.file);
    div.setAttribute('data-component-id', component.id);
    
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      selectComponent(component);
    });
    
    container.appendChild(div);
    
    // Recursively display children
    if (hasChildren) {
      displayComponentTree(container, component.children, level + 1);
      
      // Closing tag - now also clickable
      const closingDiv = document.createElement('div');
      closingDiv.className = 'component-item closing-tag';
      closingDiv.style.paddingLeft = `${level * 20}px`;
      closingDiv.innerHTML = `<span class="component-tag">&lt;/<span class="component-name">${component.name}</span>&gt;</span>`;
      closingDiv.setAttribute('title', component.file);  // Same tooltip
      closingDiv.setAttribute('data-component-id', component.id);  // Same ID
      
      // Make closing tag clickable too
      closingDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        selectComponent(component);  // Selects the same component
      });
      
      container.appendChild(closingDiv);
    }
  });
}

function selectComponent(component: BlazorComponent) {
  // Clear previous selection
  document.querySelectorAll('.component-item.selected').forEach(el => {
    el.classList.remove('selected');
  });
  
  // Add selection to clicked component
  const selected = document.querySelector(`[data-component-id="${component.id}"]`);
  if (selected) {
    selected.classList.add('selected');
  }
  
  // Display component details in side panel
  displayComponentDetails(component);
  
  // Highlight component in the page
  highlightComponentInPage(component.id);
}

function displayComponentDetails(component: BlazorComponent) {
  const detailsPanel = document.getElementById('component-details');
  if (!detailsPanel) return;
  
  detailsPanel.innerHTML = `
    <h3>${component.name}</h3>
    <div class="detail-item">
      <span class="detail-label">File:</span>
      <span class="detail-value">${component.file}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Component ID:</span>
      <span class="detail-value">${component.id}</span>
    </div>
  `;
}

function highlightComponentInPage(componentId: string) {
  chrome.devtools.inspectedWindow.eval(`
    (function() {
      // Remove previous highlights
      document.querySelectorAll('.blazor-devtools-highlight').forEach(el => {
        el.classList.remove('blazor-devtools-highlight');
      });
      
      // Add highlight to current component
      const openMarker = document.querySelector('[data-blazordevtools-id="${componentId}"]');
      const closeMarker = document.querySelector('[data-blazordevtools-marker="close"][data-blazordevtools-id="${componentId}"]');
      
      if (openMarker && closeMarker) {
        let current = openMarker.nextSibling;
        while (current && current !== closeMarker) {
          if (current.nodeType === 1) { // Element node
            current.style.outline = '2px solid #5e2ca5';
            current.style.outlineOffset = '-1px';
          }
          current = current.nextSibling;
        }
      }
    })()
  `);
}

function loadComponents() {
  chrome.devtools.inspectedWindow.eval(`
    (function() {
      const components = [];
      const openMarkers = document.querySelectorAll('[data-blazordevtools-marker="open"]');
      
      openMarkers.forEach(openMarker => {
        const id = openMarker.getAttribute('data-blazordevtools-id');
        const name = openMarker.getAttribute('data-blazordevtools-component');
        const closeMarker = document.querySelector('[data-blazordevtools-marker="close"][data-blazordevtools-id="' + id + '"]');
        
        if (closeMarker) {
          const allElements = Array.from(document.querySelectorAll('*'));
          components.push({
            id: id,
            name: name || 'Unknown',
            file: openMarker.getAttribute('data-blazordevtools-file') || '',
            nested: openMarker.getAttribute('data-blazordevtools-nested') === 'true',
            openIndex: allElements.indexOf(openMarker),
            closeIndex: allElements.indexOf(closeMarker)
          });
        }
      });
      
      const roots = [];
      components.forEach(comp => { comp.children = []; });
      
      components.forEach(child => {
        let directParent = null;
        components.forEach(parent => {
          if (parent.id !== child.id &&
              child.openIndex > parent.openIndex && 
              child.closeIndex < parent.closeIndex) {
            if (!directParent || 
                (parent.openIndex > directParent.openIndex && 
                 parent.closeIndex < directParent.closeIndex)) {
              directParent = parent;
            }
          }
        });
        
        if (directParent) {
          directParent.children.push(child);
        } else {
          roots.push(child);
        }
      });
      
      return roots;
    })()
  `, (result: any) => {
    if (result && result.length > 0) {
      const container = document.getElementById('components-tree');
      if (container) {
        container.innerHTML = '';
        displayComponentTree(container, result, 0);
      }
    } else {
      displayNoComponents();
    }
  });
}


function displayNoComponents() {
  const container = document.getElementById('components-tree');
  if (!container) return;
  
  container.innerHTML = '<div class="no-components">No Blazor components detected on this page</div>';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadComponents();
  
  // Add refresh button handler
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadComponents);
  }
});

// Refresh on navigation
chrome.devtools.network.onNavigated.addListener(() => {
  loadComponents();
});

// Add element picker functionality
let isPickerActive = false;

function enableElementPicker() {
  // Inject picker script into the page
  chrome.devtools.inspectedWindow.eval(`
    (function() {
      // Remove any existing picker
      if (window.__blazorDevToolsPicker) {
        window.__blazorDevToolsPicker.disable();
      }
      
      window.__blazorDevToolsPicker = {
        overlay: null,
        
        handleMouseMove: function(e) {
          const elem = e.target;
          
          // Find which Blazor component this element belongs to
          let current = elem;
          let componentId = null;
          let componentName = null;
          
          // Walk up the DOM to find the nearest component marker
          while (current && current !== document.body) {
            const prevSibling = current.previousSibling;
            if (prevSibling && prevSibling.nodeType === 1) {
              const marker = prevSibling.getAttribute ? prevSibling.getAttribute('data-blazordevtools-marker') : null;
              if (marker === 'open') {
                componentId = prevSibling.getAttribute('data-blazordevtools-id');
                componentName = prevSibling.getAttribute('data-blazordevtools-component');
                break;
              }
            }
            
            // Check all previous siblings
            let sibling = current;
            while (sibling) {
              sibling = sibling.previousSibling;
              if (sibling && sibling.nodeType === 1 && sibling.getAttribute) {
                const marker = sibling.getAttribute('data-blazordevtools-marker');
                if (marker === 'open') {
                  // Check if we're still within this component
                  const id = sibling.getAttribute('data-blazordevtools-id');
                  const closeMarker = document.querySelector('[data-blazordevtools-marker="close"][data-blazordevtools-id="' + id + '"]');
                  if (closeMarker) {
                    let check = current;
                    let isWithin = false;
                    while (check && check !== closeMarker) {
                      check = check.nextSibling;
                      if (check === closeMarker) {
                        isWithin = true;
                        break;
                      }
                    }
                    if (isWithin || current === sibling.nextSibling) {
                      componentId = id;
                      componentName = sibling.getAttribute('data-blazordevtools-component');
                      break;
                    }
                  }
                }
              }
            }
            
            if (componentId) break;
            current = current.parentElement;
          }
          
          // Highlight the element
          if (this.overlay) {
            const rect = elem.getBoundingClientRect();
            this.overlay.style.left = rect.left + 'px';
            this.overlay.style.top = rect.top + 'px';
            this.overlay.style.width = rect.width + 'px';
            this.overlay.style.height = rect.height + 'px';
            
            if (componentName) {
              this.overlay.setAttribute('data-component', componentName);
            }
          }
        },
        
        handleClick: function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          // Find component and send to DevTools
          let current = e.target;
          let componentId = null;
          
          while (current && current !== document.body) {
            // Same logic as mousemove to find component
            // ... (simplified for brevity)
            
            current = current.parentElement;
          }
          
          if (componentId) {
            // Send message to DevTools panel
            console.log('Selected component:', componentId);
          }
          
          this.disable();
        },
        
        enable: function() {
          // Create overlay
          this.overlay = document.createElement('div');
          this.overlay.style.position = 'fixed';
          this.overlay.style.pointerEvents = 'none';
          this.overlay.style.zIndex = '999999';
          this.overlay.style.border = '2px solid #5e2ca5';
          this.overlay.style.backgroundColor = 'rgba(94, 44, 165, 0.1)';
          document.body.appendChild(this.overlay);
          
          // Add listeners
          document.addEventListener('mousemove', this.handleMouseMove.bind(this));
          document.addEventListener('click', this.handleClick.bind(this));
          
          // Change cursor
          document.body.style.cursor = 'crosshair';
        },
        
        disable: function() {
          if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
          }
          document.removeEventListener('mousemove', this.handleMouseMove);
          document.removeEventListener('click', this.handleClick);
          document.body.style.cursor = '';
        }
      };
      
      window.__blazorDevToolsPicker.enable();
    })()
  `);
}

function disableElementPicker() {
  chrome.devtools.inspectedWindow.eval(`
    if (window.__blazorDevToolsPicker) {
      window.__blazorDevToolsPicker.disable();
      delete window.__blazorDevToolsPicker;
    }
  `);
}

// Add this to panel.ts - complete element picker implementation

function setupElementPicker() {
  const pickerBtn = document.getElementById('picker-btn');
  if (pickerBtn) {
    pickerBtn.addEventListener('click', toggleElementPicker);
  }
}

function toggleElementPicker() {
  const pickerBtn = document.getElementById('picker-btn');
  const isActive = pickerBtn?.classList.contains('active');
  
  if (!isActive) {
    pickerBtn?.classList.add('active');
    startElementPicker();
  } else {
    pickerBtn?.classList.remove('active');
    stopElementPicker();
  }
}

function startElementPicker() {
  // Inject the picker script into the inspected page
  chrome.devtools.inspectedWindow.eval(`
    (function() {
      if (window.__blazorPicker) {
        window.__blazorPicker.stop();
      }
      
      let overlay = document.createElement('div');
      overlay.id = 'blazor-picker-overlay';
      overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:999999;border:2px solid #5e2ca5;background:rgba(94,44,165,0.1);transition:all 0.1s;';
      document.body.appendChild(overlay);
      
      let label = document.createElement('div');
      label.id = 'blazor-picker-label';
      label.style.cssText = 'position:fixed;pointer-events:none;z-index:999999;background:#5e2ca5;color:white;padding:2px 6px;font-size:11px;border-radius:3px;';
      document.body.appendChild(label);
      
      function findComponentForElement(element) {
  // Find ALL components that contain this element
  const components = [];
  
  // Get all open markers
  const openMarkers = document.querySelectorAll('[data-blazordevtools-marker="open"]');
  
  openMarkers.forEach(marker => {
    const componentId = marker.getAttribute('data-blazordevtools-id');
    const componentName = marker.getAttribute('data-blazordevtools-component');
    const closeMarker = document.querySelector('[data-blazordevtools-marker="close"][data-blazordevtools-id="' + componentId + '"]');
    
    if (closeMarker) {
      // Check if element is actually between the markers
      let current = marker.nextSibling;
      let found = false;
      
      while (current && current !== closeMarker) {
        if (current === element || (current.nodeType === 1 && current.contains && current.contains(element))) {
          found = true;
          break;
        }
        current = current.nextSibling;
      }
      
      if (found) {
        // Calculate the depth by counting parent markers
        let depth = 0;
        let parent = marker.parentElement;
        while (parent) {
          const prevMarkers = parent.querySelectorAll('[data-blazordevtools-marker="open"]');
          depth += prevMarkers.length;
          parent = parent.parentElement;
        }
        
        components.push({
          id: componentId,
          name: componentName,
          openMarker: marker,
          closeMarker: closeMarker,
          depth: depth
        });
      }
    }
  });
  
  // If no components found, return null
  if (components.length === 0) return null;
  
  // If only one component, return it
  if (components.length === 1) return components[0];
  
  // Return the component with the highest depth (most nested)
  components.sort((a, b) => b.depth - a.depth);
  return components[0];
}
      
      function handleMouseMove(e) {
        const component = findComponentForElement(e.target);
        if (component) {
          const rect = e.target.getBoundingClientRect();
          overlay.style.left = rect.left + 'px';
          overlay.style.top = rect.top + 'px';
          overlay.style.width = rect.width + 'px';
          overlay.style.height = rect.height + 'px';
          overlay.style.display = 'block';
          
          label.textContent = component.name;
          
          // Position label near cursor
          label.style.left = (e.clientX + 10) + 'px';
          label.style.top = (e.clientY - 30) + 'px';
          
          // Keep label within viewport
          const labelRect = label.getBoundingClientRect();
          if (labelRect.right > window.innerWidth) {
            label.style.left = (e.clientX - labelRect.width - 10) + 'px';
          }
          if (labelRect.top < 0) {
            label.style.top = (e.clientY + 10) + 'px';
          }
          
          label.style.display = 'block';
        } else {
          overlay.style.display = 'none';
          label.style.display = 'none';
        }
      }
      
      function handleClick(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const component = findComponentForElement(e.target);
        if (component) {
          // Send the component ID back to the DevTools
          window.__blazorPickerResult = component.id;
        }
        
        window.__blazorPicker.stop();
      }
      
      window.__blazorPicker = {
        stop: function() {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('click', handleClick, true);
          document.body.style.cursor = '';
          overlay.remove();
          label.remove();
          delete window.__blazorPicker;
        }
      };
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('click', handleClick, true);
      document.body.style.cursor = 'crosshair';
    })()
  `);
  
  // Poll for selection
  const pollInterval = setInterval(() => {
    chrome.devtools.inspectedWindow.eval(
      'window.__blazorPickerResult',
      (result: string) => {
        if (result) {
          // Clear the result
          chrome.devtools.inspectedWindow.eval('delete window.__blazorPickerResult');
          
          // Stop the picker
          stopElementPicker();
          clearInterval(pollInterval);
          
          // Select the component in the tree
          selectComponentById(result);
        }
      }
    );
  }, 100);
  
  // Stop polling after 30 seconds
  setTimeout(() => clearInterval(pollInterval), 30000);
}

function stopElementPicker() {
  const pickerBtn = document.getElementById('picker-btn');
  pickerBtn?.classList.remove('active');
  
  chrome.devtools.inspectedWindow.eval(`
    if (window.__blazorPicker) {
      window.__blazorPicker.stop();
    }
  `);
}

function selectComponentById(componentId: string) {
  // Find and click the component in the tree
  const element = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;
  if (element) {
    element.click();
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Add this to the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', () => {
  loadComponents();
  setupElementPicker();  // Add this line
  
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadComponents);
  }
});

