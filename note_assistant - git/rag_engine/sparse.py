"""Reusable BM25 index for a filtered corpus snapshot."""
from collections import Counter, defaultdict
from math import log
from .text import tokens

class BM25Index:
    def __init__(self,texts):
        self.postings=defaultdict(list)
        self.lengths=[]
        for i,text in enumerate(texts):
            counts=Counter(tokens(text))
            self.lengths.append(sum(counts.values()))
            for term,tf in counts.items(): self.postings[term].append((i,tf))
        self.n=len(texts)
        self.average=sum(self.lengths)/max(1,self.n) or 1

    def score(self,query):
        scores=[0.0]*self.n
        for term in set(tokens(query)):
            posting=self.postings.get(term,[])
            idf=log(1+(self.n-len(posting)+.5)/(len(posting)+.5))
            for i,tf in posting:
                scores[i]+=idf*tf*2.5/(tf+1.5*(.25+.75*self.lengths[i]/self.average))
        return scores
