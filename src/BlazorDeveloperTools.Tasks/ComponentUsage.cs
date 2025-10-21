using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace BlazorDeveloperTools.Tasks
{
    internal class ComponentUsage
    {
        public ComponentUsage(string name, int startPos, int endPos, Match openingMatch, bool isSelfClosing = false, ComponentUsage? parent = null)
        {
            Name = name;
            StartPos = startPos;
            EndPos = endPos;
            OpeningMatch = openingMatch;
            IsSelfClosing = isSelfClosing;
            Parent = parent;
        }
        public string Name { get; set; }
        public int StartPos { get; set; }
        public int EndPos { get; set; }
        public Match OpeningMatch { get; set; }
        public bool IsSelfClosing { get; set; }
        public ComponentUsage? Parent { get; set; }
        public bool ShouldSkip { get; set; }
    }
}
