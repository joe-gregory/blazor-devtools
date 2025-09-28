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
function displayComponentTree(container: HTMLElement, components: BlazorComponent[], level: number = 0) {
  components.forEach(component => {
    const div = document.createElement('div');
    div.className = 'component-item';
    div.style.paddingLeft = `${level * 20}px`;
    
    const hasChildren = component.children && component.children.length > 0;
    
    // Create the component display
    const componentHtml = hasChildren 
      ? `<span class="component-tag">&lt;<span class="component-name">${component.name}</span>&gt;</span>`
      : `<span class="component-tag">&lt;<span class="component-name">${component.name}</span> /&gt;</span>`;
    
    div.innerHTML = componentHtml;
    div.setAttribute('title', component.file); // Show file path on hover
    div.setAttribute('data-component-id', component.id);
    
    // Add click handler for selection
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      selectComponent(component);
    });
    
    container.appendChild(div);
    
    // Recursively display children
    if (hasChildren) {
      displayComponentTree(container, component.children, level + 1);
      
      // Add closing tag
      const closingDiv = document.createElement('div');
      closingDiv.className = 'component-item';
      closingDiv.style.paddingLeft = `${level * 20}px`;
      closingDiv.innerHTML = `<span class="component-tag">&lt;/<span class="component-name">${component.name}</span>&gt;</span>`;
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

// Request and display components
function loadComponents() {
  chrome.devtools.inspectedWindow.eval(`
    (function() {
      const components = [];
      const openMarkers = document.querySelectorAll('[data-blazordevtools-marker="open"]');
      
      openMarkers.forEach(openMarker => {
        const id = openMarker.getAttribute('data-blazordevtools-id');
        const closeMarker = document.querySelector('[data-blazordevtools-marker="close"][data-blazordevtools-id="' + id + '"]');
        
        if (closeMarker) {
          // Get DOM position for hierarchy building
          const allElements = Array.from(document.querySelectorAll('*'));
          components.push({
            id: id,
            name: openMarker.getAttribute('data-blazordevtools-component') || 'Unknown',
            file: openMarker.getAttribute('data-blazordevtools-file') || '',
            openIndex: allElements.indexOf(openMarker),
            closeIndex: allElements.indexOf(closeMarker)
          });
        }
      });
      
      return components;
    })()
  `, (result: any) => {
    if (result && result.length > 0) {
      const tree = buildComponentTree(result);
      const container = document.getElementById('components-tree');
      if (container) {
        container.innerHTML = '';
        displayComponentTree(container, tree, 0);
      }
    } else {
      displayNoComponents();
    }
  });
}

function buildComponentTree(components: any[]): any[] {
  const roots: any[] = [];
  
  // First pass: add children arrays
  components.forEach(comp => {
    comp.children = [];
  });
  
  // Second pass: build relationships
  components.forEach(child => {
    let directParent: any = null;
    
    // Find the immediate parent (smallest component that contains this one)
    components.forEach(parent => {
      if (parent.id !== child.id &&
          child.openIndex > parent.openIndex && 
          child.closeIndex < parent.closeIndex) {
        if (!directParent || 
            (parent.openIndex > directParent.openIndex && parent.closeIndex < directParent.closeIndex)) {
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