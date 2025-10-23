using System;
using System.Collections.Generic;
using System.Text;

namespace BlazorDeveloperTools.Tasks
{
    /// <summary>
    /// Helper class to represent a component match with proper boundary detection
    /// </summary>
    internal class ComponentMatch
    {
        public ComponentMatch(string componentName, int startPos, int endPos, bool isClosing, bool isSelfClosing, string fullTag)
        {
            ComponentName = componentName;
            StartPos = startPos;
            EndPos = endPos;
            IsClosing = isClosing;
            IsSelfClosing = isSelfClosing;
            FullTag = fullTag;
        }
        public string ComponentName { get; set; }
        public int StartPos { get; set; }
        public int EndPos { get; set; }
        public bool IsClosing { get; set; }
        public bool IsSelfClosing { get; set; }
        public string FullTag { get; set; }
    }
}
