interface BlazorComponent {
  id: string;
  name: string;
  file: string;
  startElement: HTMLElement;
  endElement: HTMLElement;
  children: BlazorComponent[];
  content: Node[];
}

export class ComponentDetector {
  detectComponents(): Map<string, BlazorComponent> {
    const components = new Map<string, BlazorComponent>();
    const openMarkers = document.querySelectorAll('[data-blazordevtools-marker="open"]');
    
    openMarkers.forEach(startMarker => {
      const componentId = startMarker.getAttribute('data-blazordevtools-id');
      if (!componentId) return;
      
      const componentName = startMarker.getAttribute('data-blazordevtools-component');
      const filePath = startMarker.getAttribute('data-blazordevtools-file');
      
      // Find matching close marker
      const endMarker = document.querySelector(
        `[data-blazordevtools-marker="close"][data-blazordevtools-id="${componentId}"]`
      );
      
      if (endMarker) {
        const component: BlazorComponent = {
          id: componentId,
          name: componentName || 'Unknown',
          file: filePath || '',
          startElement: startMarker as HTMLElement,
          endElement: endMarker as HTMLElement,
          children: [],
          content: this.extractContentBetween(startMarker as HTMLElement, endMarker as HTMLElement)
        };
        
        components.set(componentId, component);
      }
    });
    
    // Build hierarchy
    this.buildComponentHierarchy(components);
    return components;
  }
  
  private extractContentBetween(start: HTMLElement, end: HTMLElement): Node[] {
    const content: Node[] = [];
    let current = start.nextSibling;
    
    while (current && current !== end) {
      content.push(current.cloneNode(true));
      current = current.nextSibling;
    }
    
    return content;
  }
  
  private buildComponentHierarchy(components: Map<string, BlazorComponent>) {
    components.forEach((component, id) => {
      components.forEach((potentialChild, childId) => {
        if (id !== childId && this.isNested(component, potentialChild)) {
          if (!component.children.find(c => c.id === childId)) {
            component.children.push(potentialChild);
          }
        }
      });
    });
  }
  
private isNested(parent: BlazorComponent, child: BlazorComponent): boolean {
  // Check if child's start marker comes after parent's start marker
  const childAfterParentStart = parent.startElement.compareDocumentPosition(child.startElement);
  const childStartFollows = !!(childAfterParentStart & Node.DOCUMENT_POSITION_FOLLOWING);
  
  // Check if child's end marker comes before parent's end marker
  const childBeforeParentEnd = child.endElement.compareDocumentPosition(parent.endElement);
  const childEndPrecedes = !!(childBeforeParentEnd & Node.DOCUMENT_POSITION_FOLLOWING);
  
  // Child is nested if: parent.start < child.start AND child.end < parent.end
  return childStartFollows && childEndPrecedes;
}
}